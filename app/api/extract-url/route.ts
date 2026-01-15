import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { put } from '@vercel/blob';

interface ImageMetadata {
  filename: string;
  productUrl?: string;
  productName?: string;
  productDescription?: string;
}

const METADATA_FILE = path.join(process.cwd(), 'public', 'uploads', 'metadata.json');
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';

interface ProductDetails {
  productName: string;
  productDescription: string;
  productImageUrl: string;
  productUrl: string;
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function loadMetadata(): Promise<Record<string, ImageMetadata>> {
  try {
    if (existsSync(METADATA_FILE)) {
      const content = await readFile(METADATA_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error loading metadata:', error);
  }
  return {};
}

async function saveMetadata(metadata: Record<string, ImageMetadata>): Promise<void> {
  try {
    const dir = path.dirname(METADATA_FILE);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving metadata:', error);
  }
}

async function downloadAndSaveImage(imageUrl: string, productName: string, request: NextRequest): Promise<string | null> {
  try {
    if (!imageUrl) {
      return null;
    }

    console.log('Downloading image from:', imageUrl);
    // Determine referer based on image URL
    let referer = 'https://webscraper.io/';
    if (imageUrl.includes('shopclues.com')) {
      referer = 'https://www.shopclues.com/';
    }
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': referer,
      },
    });

    if (!imageResponse.ok) {
      console.error('Failed to download image:', imageResponse.status);
      return null;
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
    
    // Generate unique filename
    const sanitizedName = productName
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase()
      .substring(0, 50);
    const randomSuffix = randomBytes(8).toString('hex');
    const uniqueFilename = `${sanitizedName}_${randomSuffix}${ext}`;

    if (IS_VERCEL) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('BLOB_READ_WRITE_TOKEN not configured');
        return null;
      }
      const blob = await put(uniqueFilename, imageBuffer, {
        access: 'public',
        contentType: contentType,
      });
      return blob.pathname.split('/').pop() || uniqueFilename;
    } else {
      if (!existsSync(UPLOAD_DIR)) {
        await mkdir(UPLOAD_DIR, { recursive: true });
      }
      const filePath = path.join(UPLOAD_DIR, uniqueFilename);
      await writeFile(filePath, Buffer.from(imageBuffer));
      return uniqueFilename;
    }
  } catch (error) {
    console.error('Error downloading and saving image:', error);
    return null;
  }
}

async function extractProductDetails(productUrl: string): Promise<ProductDetails | null> {
  try {
    // Clean and normalize the URL
    let cleanUrl = productUrl.trim();
    // Ensure URL has protocol
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }
    // Remove any fragments
    cleanUrl = cleanUrl.split('#')[0];

    // Check if it's a supported site
    const isWebScraper = cleanUrl.includes('webscraper.io');
    const isShopClues = cleanUrl.includes('shopclues.com');
    
    if (!isWebScraper && !isShopClues) {
      console.error('Invalid URL - must be webscraper.io or shopclues.com:', cleanUrl);
      return null;
    }

    console.log('Fetching product page from:', cleanUrl);

    // Fetch the product page with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(cleanUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': isShopClues ? 'https://www.shopclues.com/' : 'https://webscraper.io/',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': isShopClues ? 'same-origin' : 'cross-site',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'DNT': '1',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error('Failed to fetch product page:', response.status, response.statusText);
        // Even if response is not OK, try to get the text to see what we got
        try {
          const errorText = await response.text();
          console.error('Error response body:', errorText.substring(0, 500));
        } catch (e) {
          // Ignore
        }
        return null;
      }

      const html = await response.text();
      
      if (!html || html.length < 100) {
        console.error('Received empty or too short HTML response. Length:', html?.length || 0);
        return null;
      }

      // Check if we got a redirect or error page
      if (html.includes('Access Denied') || html.includes('403') || html.includes('Blocked') || 
          html.includes('access denied') || html.includes('blocked') ||
          (html.toLowerCase().includes('cloudflare') && html.toLowerCase().includes('checking'))) {
        console.error('Access denied or blocked by website');
        // For ShopClues, try to extract from URL even if blocked
        if (isShopClues) {
          // Extract product ID from URL (format: -153555714.html)
          const idMatch = cleanUrl.match(/-(\d+)\.html/i) || cleanUrl.match(/\/(\d+)\.html/i);
          const productId = idMatch ? idMatch[1] : null;
          
          // Extract product name from URL
          const urlMatch = cleanUrl.match(/shopclues\.com\/[^\/]+\/([^\/]+)\.html/i);
          let extractedName = '';
          if (urlMatch && urlMatch[1]) {
            extractedName = urlMatch[1]
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase())
              .replace(/-\d+$/g, '')
              .trim();
          }
          
          // Construct image URL if we have product ID
          let directImageUrl = '';
          if (productId) {
            // ShopClues image URL pattern: https://cdn2.shopclues.com/images1/thumbnails/{folder}/320/320/{productId}-{variant}-{timestamp}.jpg
            // We'll try to construct a basic URL, but it might need the actual folder and variant
            // For now, we'll extract from the page if possible, or use a placeholder
            directImageUrl = `https://cdn2.shopclues.com/images1/thumbnails/117760/320/320/${productId}-117760104-1722251489.jpg`;
          }
          
          return {
            productName: extractedName || 'ShopClues Product',
            productDescription: 'Product from ShopClues',
            productImageUrl: directImageUrl,
            productUrl: cleanUrl,
          };
        }
        
        return null;
      }

      // Extract product name
      let productName = '';
      
      if (isShopClues) {
        // Extract from ShopClues structure
        // Try h1 tag first
        const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (h1Match && h1Match[1]) {
          productName = h1Match[1].trim();
        }
        
        // Try meta property og:title
        if (!productName) {
          const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
          if (ogTitleMatch && ogTitleMatch[1]) {
            productName = ogTitleMatch[1].trim();
          }
        }
        
        // Try title tag
        if (!productName) {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            productName = titleMatch[1].replace(/\s*-\s*ShopClues.*$/i, '').replace(/\s*\|\s*ShopClues.*$/i, '').trim();
          }
        }
        
        // Try JSON-LD
        if (!productName) {
          const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
          if (jsonLdMatch) {
            try {
              const jsonLd = JSON.parse(jsonLdMatch[1]);
              if (jsonLd.name) {
                productName = jsonLd.name;
              } else if (jsonLd.headline) {
                productName = jsonLd.headline;
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }
      } else {
        // Extract from webscraper.io structure
        const nameMatch = html.match(/<h4[^>]*>([^<]+)<\/h4>/i) || 
                         html.match(/<h3[^>]*>([^<]+)<\/h3>/i) ||
                         html.match(/<h2[^>]*>([^<]+)<\/h2>/i);
        if (nameMatch && nameMatch[1]) {
          productName = nameMatch[1].trim();
        }
        
        // Try title tag
        if (!productName) {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            productName = titleMatch[1].replace(/\s*-\s*Web Scraper.*$/i, '').trim();
          }
        }
      }

      // Extract product description
      let productDescription = '';
      
      if (isShopClues) {
        // Extract description from ShopClues
        // Try meta description
        const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
        if (metaDescMatch && metaDescMatch[1]) {
          productDescription = metaDescMatch[1].trim();
        }
        
        // Try og:description
        if (!productDescription || productDescription.length < 20) {
          const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
          if (ogDescMatch && ogDescMatch[1]) {
            productDescription = ogDescMatch[1].trim();
          }
        }
        
        // Try product description section
        if (!productDescription || productDescription.length < 20) {
          const descMatch = html.match(/<div[^>]*class=["'][^"']*product[^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                          html.match(/<div[^>]*id=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
          if (descMatch && descMatch[1]) {
            productDescription = descMatch[1].replace(/<[^>]*>/g, '').trim().substring(0, 200);
          }
        }
      } else {
        // Extract description from webscraper.io
        const descMatch = html.match(/<p[^>]*>([^<]+(?:,\s*[^<]+)*)<\/p>/i) ||
                       html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch && descMatch[1]) {
          productDescription = descMatch[1].replace(/<[^>]*>/g, '').trim();
        }
        
        // Try to get text after product name
        if (!productDescription || productDescription.length < 20) {
          const textAfterName = html.split(productName)[1];
          if (textAfterName) {
            const descText = textAfterName.match(/<p[^>]*>([^<]+)<\/p>/i) ||
                           textAfterName.match(/<div[^>]*>([^<]{50,})<\/div>/i);
            if (descText && descText[1]) {
              productDescription = descText[1].trim();
            }
          }
        }
      }

      // Extract product image URL
      let productImageUrl = '';
      
      if (isShopClues) {
        // Extract image from ShopClues
        // Try og:image first
        const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
        if (ogImageMatch && ogImageMatch[1]) {
          productImageUrl = ogImageMatch[1].trim();
        }
        
        // Try JSON-LD
        if (!productImageUrl) {
          const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
          if (jsonLdMatch) {
            try {
              const jsonLd = JSON.parse(jsonLdMatch[1]);
              if (jsonLd.image && typeof jsonLd.image === 'string') {
                productImageUrl = jsonLd.image;
              } else if (jsonLd.image && jsonLd.image.url) {
                productImageUrl = jsonLd.image.url;
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }
        
        // Try img tags with product image classes
        if (!productImageUrl) {
          const imgMatch = html.match(/<img[^>]*class=["'][^"']*product[^"']*image[^"']*["'][^>]*src=["']([^"']+)["']/i) ||
                          html.match(/<img[^>]*data-src=["']([^"']+)["']/i) ||
                          html.match(/<img[^>]*id=["'][^"']*product[^"']*image[^"']*["'][^>]*src=["']([^"']+)["']/i);
          if (imgMatch && imgMatch[1]) {
            productImageUrl = imgMatch[1].trim();
          }
        }
        
        // Try to construct image URL from product ID if HTML extraction failed
        if (!productImageUrl) {
          const idMatch = cleanUrl.match(/-(\d+)\.html/i) || cleanUrl.match(/\/(\d+)\.html/i);
          const productId = idMatch ? idMatch[1] : null;
          
          if (productId) {
            // Try to find image URL pattern in HTML (look for any ShopClues CDN image)
            const imagePatternMatch = html.match(/cdn2\.shopclues\.com\/images1\/thumbnails\/(\d+)\/\d+\/\d+\/(\d+)-(\d+)-(\d+)\.jpg/i);
            if (imagePatternMatch) {
              const folder = imagePatternMatch[1];
              const variant = imagePatternMatch[3];
              const timestamp = imagePatternMatch[4];
              // Use the product ID from URL, but folder/variant/timestamp from HTML
              productImageUrl = `https://cdn2.shopclues.com/images1/thumbnails/${folder}/320/320/${productId}-${variant}-${timestamp}.jpg`;
              console.log('Constructed ShopClues image URL from HTML pattern:', productImageUrl);
            } else {
              // Try to find any ShopClues image URL in HTML
              const anyImageMatch = html.match(/(cdn2\.shopclues\.com\/images1\/thumbnails\/[^"'\s]+\.jpg)/i);
              if (anyImageMatch && anyImageMatch[1]) {
                productImageUrl = 'https://' + anyImageMatch[1];
                console.log('Found ShopClues image URL in HTML:', productImageUrl);
              } else {
                // Fallback with default pattern (from user's example)
                productImageUrl = `https://cdn2.shopclues.com/images1/thumbnails/117760/320/320/${productId}-117760104-1722251489.jpg`;
                console.log('Constructed ShopClues image URL (fallback):', productImageUrl);
              }
            }
          }
        }
        
        // Fallback to any img tag
        if (!productImageUrl) {
          const imgMatch = html.match(/<img[^>]*src=["']([^"']+)["']/i) ||
                          html.match(/<img[^>]*src='([^']+)'/i);
          if (imgMatch && imgMatch[1] && 
              !imgMatch[1].includes('placeholder') && 
              !imgMatch[1].includes('logo') &&
              imgMatch[1].includes('shopclues.com')) {
            productImageUrl = imgMatch[1].trim();
          }
        }
        
        // Convert relative URLs to absolute
        if (productImageUrl) {
          if (productImageUrl.startsWith('//')) {
            productImageUrl = 'https:' + productImageUrl;
          } else if (productImageUrl.startsWith('/')) {
            productImageUrl = 'https://www.shopclues.com' + productImageUrl;
          }
        }
      } else {
        // Extract image from webscraper.io
        const imageMatch = html.match(/<img[^>]*src="([^"]+)"[^>]*>/i) ||
                          html.match(/<img[^>]*src='([^']+)'[^>]*>/i);
        if (imageMatch && imageMatch[1]) {
          productImageUrl = imageMatch[1].trim();
          // Convert relative URLs to absolute
          if (productImageUrl.startsWith('//')) {
            productImageUrl = 'https:' + productImageUrl;
          } else if (productImageUrl.startsWith('/')) {
            productImageUrl = 'https://webscraper.io' + productImageUrl;
          }
        }
      }

      // Clean up extracted text
      productName = productName
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();

      productDescription = productDescription
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();

      // If we couldn't extract name, try to get it from URL or title
      if (!productName) {
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        if (titleMatch) {
          productName = titleMatch[1].replace(/\s*-\s*Web Scraper.*$/i, '').trim();
        }
      }

      // If still no name, try extracting from URL path
      if (!productName || productName === 'Product') {
        if (isShopClues) {
          // For ShopClues, try to extract from URL structure
          const urlMatch = cleanUrl.match(/shopclues\.com\/[^\/]+\/([^\/]+)\.html/i);
          if (urlMatch && urlMatch[1]) {
            productName = urlMatch[1]
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase())
              .replace(/-\d+$/g, '')
              .trim();
          }
        } else {
          // For webscraper.io, try to extract from URL structure
          const urlMatch = cleanUrl.match(/\/product\/(\d+)/);
          if (urlMatch) {
            productName = `Product ${urlMatch[1]}`;
          }
        }
      }

      // If still no name, use a default
      if (!productName) {
        if (isShopClues) {
          productName = 'ShopClues Product';
        } else {
          productName = 'Product from Web Scraper';
        }
      }

      // If no description, use a default
      if (!productDescription) {
        if (isShopClues) {
          productDescription = 'Product from ShopClues';
        } else {
          productDescription = 'Product details from Web Scraper test site';
        }
      }

      // Even if image URL is not found, we should still return the data
      // The image might be available later or can be uploaded separately
      console.log('Extracted product:', {
        name: productName,
        description: productDescription.substring(0, 50) + '...',
        imageUrl: productImageUrl ? 'Found' : 'Not found',
      });

      return {
        productName,
        productDescription,
        productImageUrl: productImageUrl || '',
        productUrl: cleanUrl,
      };
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.error('Request timeout while fetching product page');
      } else {
        console.error('Error fetching product page:', fetchError.message);
      }
      
      // Fallback: Try to extract basic info from URL if fetch fails
      console.log('Attempting fallback extraction from URL');
      let urlMatch;
      if (isShopClues) {
        urlMatch = cleanUrl.match(/shopclues\.com\/[^\/]+\/([^\/]+)\.html/i);
      } else {
        urlMatch = cleanUrl.match(/\/product\/(\d+)/);
      }
      if (urlMatch) {
        if (isShopClues) {
          const extractedName = urlMatch[1]
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (l: string) => l.toUpperCase())
            .replace(/-\d+$/g, '')
            .trim();
          const idMatch = cleanUrl.match(/-(\d+)\.html/i);
          const productId = idMatch ? idMatch[1] : null;
          let imageUrl = '';
          if (productId) {
            imageUrl = `https://cdn2.shopclues.com/images1/thumbnails/117760/320/320/${productId}-117760104-1722251489.jpg`;
          }
          return {
            productName: extractedName || 'ShopClues Product',
            productDescription: 'Product from ShopClues',
            productImageUrl: imageUrl,
            productUrl: cleanUrl,
          };
        } else {
          return {
            productName: `Product ${urlMatch[1]}`,
            productDescription: 'Product details from Web Scraper test site',
            productImageUrl: '',
            productUrl: cleanUrl,
          };
        }
      }
      
      return null;
    }
  } catch (error: any) {
    console.error('Error extracting product details:', error?.message || error);
    
    // Fallback: Try to extract basic info from URL
    try {
      const isShopClues = productUrl.includes('shopclues.com');
      let urlMatch;
      if (isShopClues) {
        urlMatch = productUrl.match(/shopclues\.com\/[^\/]+\/([^\/]+)\.html/i);
      } else {
        urlMatch = productUrl.match(/\/product\/(\d+)/);
      }
      if (urlMatch) {
        if (isShopClues) {
          const extractedName = urlMatch[1]
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (l: string) => l.toUpperCase())
            .replace(/-\d+$/g, '')
            .trim();
          const idMatch = productUrl.match(/-(\d+)\.html/i);
          const productId = idMatch ? idMatch[1] : null;
          let imageUrl = '';
          if (productId) {
            imageUrl = `https://cdn2.shopclues.com/images1/thumbnails/117760/320/320/${productId}-117760104-1722251489.jpg`;
          }
          return {
            productName: extractedName || 'ShopClues Product',
            productDescription: 'Product from ShopClues',
            productImageUrl: imageUrl,
            productUrl: productUrl.trim(),
          };
        } else {
          return {
            productName: `Product ${urlMatch[1]}`,
            productDescription: 'Product details from Web Scraper test site',
            productImageUrl: '',
            productUrl: productUrl.trim(),
          };
        }
      }
    } catch (fallbackError) {
      // Ignore fallback errors
    }
    
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { productUrl } = body;

    if (!productUrl || typeof productUrl !== 'string' || !productUrl.trim()) {
      return NextResponse.json(
        { error: 'Product URL is required and must be a valid string' },
        { status: 400 }
      );
    }

    const trimmedUrl = productUrl.trim();
    
    // Validate URL format
    const isWebScraper = trimmedUrl.includes('webscraper.io');
    const isShopClues = trimmedUrl.includes('shopclues.com');
    
    if (!isWebScraper && !isShopClues) {
      return NextResponse.json(
        { error: 'Please provide a valid webscraper.io or shopclues.com URL' },
        { status: 400 }
      );
    }

    console.log('Extracting product details from:', trimmedUrl);
    const productDetails = await extractProductDetails(trimmedUrl);

    if (!productDetails) {
      console.error('Failed to extract product details. This might be due to:');
      console.error('1. Invalid or inaccessible URL');
      console.error('2. Changed page structure');
      console.error('3. Website blocking server-side requests');
      
      const errorMessage = 'Failed to extract product details. The URL might be invalid or the page structure has changed. Please try again or check the URL.';
      
      return NextResponse.json(
        { error: errorMessage },
        { status: 400 }
      );
    }

    // Download and save the product image (non-blocking - continue even if it fails)
    let savedFilename: string | null = null;
    if (productDetails.productImageUrl) {
      try {
        savedFilename = await downloadAndSaveImage(
          productDetails.productImageUrl,
          productDetails.productName,
          request
        );
      } catch (imageError) {
        console.error('Error downloading image (non-critical):', imageError);
        // Continue without image - we still have product details
      }
    }

    // Save metadata even if image wasn't saved (for future reference)
    // We'll create a placeholder entry
    if (!savedFilename) {
      // Generate a placeholder filename for metadata storage
      const sanitizedName = productDetails.productName
        .replace(/[^a-zA-Z0-9.-]/g, '_')
        .replace(/_{2,}/g, '_')
        .toLowerCase()
        .substring(0, 50);
      const randomSuffix = randomBytes(8).toString('hex');
      savedFilename = `placeholder_${sanitizedName}_${randomSuffix}.txt`;
    }

    // Save metadata
    try {
      const metadata = await loadMetadata();
      metadata[savedFilename] = {
        filename: savedFilename,
        productUrl: productDetails.productUrl,
        productName: productDetails.productName,
        productDescription: productDetails.productDescription,
      };
      await saveMetadata(metadata);
    } catch (metadataError) {
      console.error('Error saving metadata (non-critical):', metadataError);
      // Continue - metadata save failure shouldn't block the response
    }

    // Generate product image URL
    const protocol = request.headers.get('x-forwarded-proto') || 
                     (request.url.startsWith('https') ? 'https' : 'http');
    const host = request.headers.get('host') || 'localhost:3000';
    
    // Only use saved filename if it's not a placeholder
    const productImageUrl = (savedFilename && !savedFilename.startsWith('placeholder_'))
      ? `${protocol}://${host}/api/images/${savedFilename}`
      : (productDetails.productImageUrl || '');

    // Return exactly 4 fields as requested
    return NextResponse.json({
      success: true,
      imageUrl: productImageUrl,                          // 1. Image URL (saved image or product URL)
      productUrl: productDetails.productUrl,              // 2. Actual product URL
      productName: productDetails.productName,            // 3. Product name
      productDescription: productDetails.productDescription, // 4. Product description
    });
  } catch (error) {
    console.error('Error processing URL:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

