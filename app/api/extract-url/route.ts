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
  productImageUrl?: string;
}

const METADATA_FILE = path.join(process.cwd(), 'public', 'uploads', 'metadata.json');
const METADATA_BLOB_NAME = 'metadata.json'; // Name for metadata in Vercel Blob Storage
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
    if (IS_VERCEL) {
      // On Vercel, load from Blob Storage
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.warn('BLOB_READ_WRITE_TOKEN not configured, returning empty metadata');
        return {};
      }
      try {
        const { list } = await import('@vercel/blob');
        const blobs = await list({ prefix: METADATA_BLOB_NAME, limit: 1 });
        if (blobs.blobs.length > 0) {
          const metadataBlob = blobs.blobs[0];
          const response = await fetch(metadataBlob.url);
          if (response.ok) {
            const content = await response.text();
            return JSON.parse(content);
          }
        }
      } catch (error) {
        console.error('Error loading metadata from blob:', error);
      }
      return {};
    } else {
      // On local, load from filesystem
      if (existsSync(METADATA_FILE)) {
        const content = await readFile(METADATA_FILE, 'utf-8');
        return JSON.parse(content);
      }
    }
  } catch (error) {
    console.error('Error loading metadata:', error);
  }
  return {};
}

async function saveMetadata(metadata: Record<string, ImageMetadata>): Promise<void> {
  try {
    if (IS_VERCEL) {
      // On Vercel, save to Blob Storage
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.warn('BLOB_READ_WRITE_TOKEN not configured, cannot save metadata');
        return;
      }
      const { put } = await import('@vercel/blob');
      const metadataJson = JSON.stringify(metadata, null, 2);
      await put(METADATA_BLOB_NAME, metadataJson, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false, // Keep the same filename
      });
    } else {
      // On local, save to filesystem
      const dir = path.dirname(METADATA_FILE);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
    }
  } catch (error) {
    console.error('Error saving metadata:', error);
    // Don't throw on Vercel - metadata save failures shouldn't break the API
    if (!IS_VERCEL) {
      throw error;
    }
  }
}

async function downloadAndSaveImage(imageUrl: string, productName: string, request: NextRequest): Promise<string | null> {
  try {
    if (!imageUrl) {
      return null;
    }

    console.log('Downloading image from:', imageUrl);
    // Always use LimeRoad as referer for downloaded images
    const referer = 'https://www.limeroad.com/';
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
      // Return uniqueFilename for metadata key (Vercel might add suffix to pathname)
      return uniqueFilename;
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

    // Check if it's a supported site (only LimeRoad now)
    const isShopClues = cleanUrl.includes('limeroad.com');
    if (!isShopClues) {
      console.error('Invalid URL - must be limeroad.com:', cleanUrl);
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
          'Referer': 'https://www.limeroad.com/',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
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
        // For LimeRoad, try to extract from URL even if blocked
        if (isShopClues) {
          // Extract product ID from URL if present
          const idMatch = cleanUrl.match(/-p(\d+)/i) || cleanUrl.match(/\/p(\d+)/i);
          const productId = idMatch ? idMatch[1] : null;
          
          // Extract product name from URL
          const urlMatch = cleanUrl.match(/limeroad\.com\/[^\/?]+/i);
          let extractedName = '';
          if (urlMatch && urlMatch[1]) {
            extractedName = urlMatch[1]
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase())
              .replace(/-\d+$/g, '')
              .trim();
          }
          
          // Construct image URL if we have product ID
          // LimeRoad is blocking server-side image access, so use a safe
          // placeholder/external image URL instead.
          let directImageUrl = 'https://fakestoreapi.com/img/81fPKd-2AYL._AC_SL1500_t.png';
          
          return {
            productName: extractedName || 'LimeRoad Product',
            productDescription: 'Product from LimeRoad',
            productImageUrl: directImageUrl,
            productUrl: cleanUrl,
          };
        }
        
        return null;
      }

      // Extract product name from LimeRoad structure
      let productName = '';
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
          productName = titleMatch[1]
            .replace(/\s*-\s*LimeRoad.*$/i, '')
            .replace(/\s*\|\s*LimeRoad.*$/i, '')
            .trim();
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

      // Extract product description
      let productDescription = '';
      // Extract description from LimeRoad
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

      // Extract product image URL
      let productImageUrl = '';
      // Extract image from LimeRoad
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
      // Try LimeRoad-specific image patterns
      if (!productImageUrl) {
        // 1) Main product image on LimeRoad uses itemprop="image" OR zmimgH class
        const imgMatch =
          html.match(/<img[^>]*itemprop=["']image["'][^>]*data-src=["']([^"']+)["'][^>]*>/i) ||
          html.match(/<img[^>]*itemprop=["']image["'][^>]*src=["']([^"']+)["'][^>]*>/i) ||
          html.match(/<img[^>]*class=["'][^"']*zmimgH[^"']*["'][^>]*data-src=["']([^"']+)["'][^>]*>/i) ||
          html.match(/<img[^>]*class=["'][^"']*zmimgH[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/i) ||
          html.match(/<img[^>]*data-src=["']([^"']+junaroad\.com[^"']*)["'][^>]*>/i);
        if (imgMatch && imgMatch[1]) {
          productImageUrl = imgMatch[1].trim();
        }
      }
      // Fallback to any img tag that looks like a product image (junaroad or limeroad domains)
      if (!productImageUrl) {
        const imgMatch =
          html.match(/<img[^>]*src=["']([^"']+junaroad\.com[^"']*)["'][^>]*>/i) ||
          html.match(/<img[^>]*src=["']([^"']+limeroad\.com[^"']*)["'][^>]*>/i) ||
          html.match(/<img[^>]*src='([^']+junaroad\.com[^']*)'[^>]*>/i) ||
          html.match(/<img[^>]*src='([^']+limeroad\.com[^']*)'[^>]*>/i);
        if (imgMatch && imgMatch[1] && 
            !imgMatch[1].includes('placeholder') && 
            !imgMatch[1].includes('logo')) {
          productImageUrl = imgMatch[1].trim();
        }
      }
      // Convert relative URLs to absolute
      if (productImageUrl) {
        if (productImageUrl.startsWith('//')) {
          productImageUrl = 'https:' + productImageUrl;
        } else if (productImageUrl.startsWith('/')) {
          productImageUrl = 'https://www.limeroad.com' + productImageUrl;
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

      // If still no name, try extracting from LimeRoad URL path
      if (!productName || productName === 'Product') {
        const urlMatch = cleanUrl.match(/limeroad\.com\/([^/?]+)/i);
        if (urlMatch && urlMatch[1]) {
          productName = urlMatch[1]
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (l: string) => l.toUpperCase())
            .replace(/-\d+$/g, '')
            .trim();
        }
      }

      // If still no name, use a default
      if (!productName) {
        productName = 'LimeRoad Product';
      }
      // If no description, use a default
      if (!productDescription) {
        productDescription = 'Product from LimeRoad';
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
        urlMatch = cleanUrl.match(/limeroad\.com\/([^/?]+)/i);
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
          return {
            productName: extractedName || 'LimeRoad Product',
            productDescription: 'Product from LimeRoad',
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
      const isShopClues = productUrl.includes('limeroad.com');
      let urlMatch;
      if (isShopClues) {
        urlMatch = productUrl.match(/limeroad\.com\/([^/?]+)/i);
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
          return {
            productName: extractedName || 'LimeRoad Product',
            productDescription: 'Product from LimeRoad',
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
    
    // Validate URL format (only LimeRoad is allowed now)
    const isShopClues = trimmedUrl.includes('limeroad.com');
    
    if (!isShopClues) {
      return NextResponse.json(
        { error: 'Please provide a valid limeroad.com URL' },
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
        // Persist productImageUrl as well so /api/images can use external URLs
        productImageUrl: productDetails.productImageUrl || undefined,
      };
      await saveMetadata(metadata);
      console.log('Saved metadata for:', savedFilename, 'with productUrl:', productDetails.productUrl);
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

