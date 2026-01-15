import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { put } from '@vercel/blob';

interface ImageMetadata {
  filename: string;
  flipkartUrl?: string;
  productName?: string;
  productDescription?: string;
}

const METADATA_FILE = path.join(process.cwd(), 'public', 'uploads', 'metadata.json');
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';

interface FlipkartProductDetails {
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
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.flipkart.com/',
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

async function extractFlipkartProductDetails(flipkartUrl: string): Promise<FlipkartProductDetails | null> {
  try {
    // Validate Flipkart URL
    if (!flipkartUrl.includes('flipkart.com')) {
      console.error('Invalid Flipkart URL:', flipkartUrl);
      return null;
    }

    // Clean and normalize the URL
    let cleanUrl = flipkartUrl.trim();
    // Ensure URL has protocol
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }
    // Remove any fragments
    cleanUrl = cleanUrl.split('#')[0];

    console.log('Fetching Flipkart page from:', cleanUrl);

    // Fetch the Flipkart product page with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(cleanUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://www.flipkart.com/',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error('Failed to fetch Flipkart page:', response.status, response.statusText);
        return null;
      }

      const html = await response.text();
      
      if (!html || html.length < 100) {
        console.error('Received empty or too short HTML response');
        return null;
      }
    
      // Extract product name - Look for various possible selectors
      let productName = '';
      
      // Try to extract from JSON-LD structured data first
      try {
        const jsonLdMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
        for (const match of jsonLdMatches) {
          try {
            const jsonData = JSON.parse(match[1]);
            if (jsonData.name) {
              productName = jsonData.name;
              break;
            }
            if (jsonData['@graph']) {
              for (const item of jsonData['@graph']) {
                if (item.name && item['@type'] === 'Product') {
                  productName = item.name;
                  break;
                }
              }
              if (productName) break;
            }
          } catch (e) {
            // Continue to next pattern
          }
        }
      } catch (e) {
        // Continue to regex patterns
      }

      if (!productName) {
        const namePatterns = [
          /<h1[^>]*class="[^"]*B_NuCI[^"]*"[^>]*>(.*?)<\/h1>/i,
          /<span[^>]*class="[^"]*B_NuCI[^"]*"[^>]*>(.*?)<\/span>/i,
          /<h1[^>]*class="[^"]*yhB1nd[^"]*"[^>]*>(.*?)<\/h1>/i,
          /<h1[^>]*>(.*?)<\/h1>/i,
          /"productName"\s*:\s*"([^"]+)"/i,
          /"name"\s*:\s*"([^"]+)"/i,
          /<title>(.*?)\s*-\s*Flipkart<\/title>/i,
        ];

        for (const pattern of namePatterns) {
          const match = html.match(pattern);
          if (match && match[1]) {
            productName = match[1].replace(/<[^>]*>/g, '').trim();
            if (productName && productName.length > 3) break;
          }
        }
      }

      // Extract product description - Try multiple patterns
      let productDescription = '';
      
      // Try JSON-LD structured data first
      try {
        const jsonLdMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
        for (const match of jsonLdMatches) {
          try {
            const jsonData = JSON.parse(match[1]);
            if (jsonData.description) {
              productDescription = jsonData.description;
              break;
            }
            if (jsonData['@graph']) {
              for (const item of jsonData['@graph']) {
                if (item.description && item['@type'] === 'Product') {
                  productDescription = item.description;
                  break;
                }
              }
              if (productDescription) break;
            }
          } catch (e) {
            // Continue to next pattern
          }
        }
      } catch (e) {
        // Continue to regex patterns
      }

      if (!productDescription || productDescription.length < 20) {
        const descPatterns = [
          // Try meta description
          /<meta[^>]*name="description"[^>]*content="([^"]+)"/i,
          /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i,
          // Try specific Flipkart classes
          /<div[^>]*class="[^"]*_1mXcCf[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
          /<div[^>]*class="[^"]*RmoJUa[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
          /<p[^>]*class="[^"]*_2-N8zT[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
          /<div[^>]*class="[^"]*_2418kt[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
          // Try bullet points/features
          /<li[^>]*class="[^"]*_21Ahn-[^"]*"[^>]*>([\s\S]*?)<\/li>/i,
        ];

        for (const pattern of descPatterns) {
          const match = html.match(pattern);
          if (match && match[1]) {
            let desc = match[1].replace(/<[^>]*>/g, '').trim();
            desc = desc.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
            if (desc && desc.length > 20) {
              productDescription = desc;
              break;
            }
          }
        }
      }
      
      // If multiple matches found, combine them
      if (!productDescription || productDescription.length < 50) {
        const allMatches = html.matchAll(/<li[^>]*class="[^"]*_21Ahn-[^"]*"[^>]*>([\s\S]*?)<\/li>/gi);
        const features: string[] = [];
        for (const match of allMatches) {
          if (match[1]) {
            const feature = match[1].replace(/<[^>]*>/g, '').trim();
            if (feature && feature.length > 10) {
              features.push(feature);
            }
          }
        }
        if (features.length > 0) {
          productDescription = features.join('. ') + (productDescription ? '. ' + productDescription : '');
        }
      }

      // Extract product image URL - Try multiple patterns
      let productImageUrl = '';
      
      // Try JSON-LD structured data first
      try {
        const jsonLdMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
        for (const match of jsonLdMatches) {
          try {
            const jsonData = JSON.parse(match[1]);
            if (jsonData.image) {
              if (Array.isArray(jsonData.image)) {
                productImageUrl = jsonData.image[0];
              } else if (typeof jsonData.image === 'string') {
                productImageUrl = jsonData.image;
              }
              if (productImageUrl) break;
            }
            if (jsonData['@graph']) {
              for (const item of jsonData['@graph']) {
                if (item.image && item['@type'] === 'Product') {
                  if (Array.isArray(item.image)) {
                    productImageUrl = item.image[0];
                  } else if (typeof item.image === 'string') {
                    productImageUrl = item.image;
                  }
                  if (productImageUrl) break;
                }
              }
              if (productImageUrl) break;
            }
          } catch (e) {
            // Continue to next pattern
          }
        }
      } catch (e) {
        // Continue to regex patterns
      }

      if (!productImageUrl) {
        const imagePatterns = [
          // Try meta tags
          /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i,
          /<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"/i,
          // Try img tags with specific classes
          /<img[^>]*class="[^"]*q6DClP[^"]*"[^>]*src="([^"]+)"/i,
          /<img[^>]*class="[^"]*_396cs4[^"]*"[^>]*src="([^"]+)"/i,
          /<img[^>]*class="[^"]*CXW8mj[^"]*"[^>]*src="([^"]+)"/i,
          /<img[^>]*class="[^"]*_2r_T1I[^"]*"[^>]*src="([^"]+)"/i,
          // Try data-src (lazy loaded images)
          /<img[^>]*data-src="([^"]+)"/i,
          // Try any img tag in product container
          /<div[^>]*class="[^"]*CXW8mj[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i,
        ];

        for (const pattern of imagePatterns) {
          const match = html.match(pattern);
          if (match && match[1]) {
            productImageUrl = match[1].trim();
            if (productImageUrl && !productImageUrl.startsWith('data:')) {
              // Convert relative URLs to absolute
              if (productImageUrl.startsWith('//')) {
                productImageUrl = 'https:' + productImageUrl;
              } else if (productImageUrl.startsWith('/')) {
                productImageUrl = 'https://www.flipkart.com' + productImageUrl;
              }
              // Remove query parameters that might cause issues
              productImageUrl = productImageUrl.split('?')[0];
              if (productImageUrl.includes('flipkart') || productImageUrl.includes('img') || productImageUrl.includes('cdn')) {
                break;
              }
            }
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
          productName = titleMatch[1].replace(/\s*-\s*Flipkart.*$/i, '').trim();
        }
      }

      // If still no name, use a default
      if (!productName) {
        productName = 'Product from Flipkart';
      }

      // If no description, use a default
      if (!productDescription) {
        productDescription = 'Product details from Flipkart';
      }

      return {
        productName,
        productDescription,
        productImageUrl: productImageUrl || '',
        productUrl: cleanUrl,
      };
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.error('Request timeout while fetching Flipkart page');
      } else {
        console.error('Error fetching Flipkart page:', fetchError.message);
      }
      return null;
    }
  } catch (error: any) {
    console.error('Error extracting Flipkart product details:', error?.message || error);
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

    const { flipkartUrl } = body;

    if (!flipkartUrl || typeof flipkartUrl !== 'string' || !flipkartUrl.trim()) {
      return NextResponse.json(
        { error: 'Flipkart URL is required and must be a valid string' },
        { status: 400 }
      );
    }

    const trimmedUrl = flipkartUrl.trim();
    
    // Validate URL format
    if (!trimmedUrl.includes('flipkart.com')) {
      return NextResponse.json(
        { error: 'Please provide a valid Flipkart product URL' },
        { status: 400 }
      );
    }

    console.log('Extracting Flipkart product details from:', trimmedUrl);
    const productDetails = await extractFlipkartProductDetails(trimmedUrl);

    if (!productDetails) {
      return NextResponse.json(
        { error: 'Failed to extract product details. The URL might be invalid or the page structure has changed. Please try again or check the URL.' },
        { status: 400 }
      );
    }

    // Download and save the product image
    let savedFilename: string | null = null;
    if (productDetails.productImageUrl) {
      savedFilename = await downloadAndSaveImage(
        productDetails.productImageUrl,
        productDetails.productName,
        request
      );
    }

    // Save metadata if image was saved
    if (savedFilename) {
      const metadata = await loadMetadata();
      metadata[savedFilename] = {
        filename: savedFilename,
        flipkartUrl: productDetails.productUrl,
        productName: productDetails.productName,
        productDescription: productDetails.productDescription,
      };
      await saveMetadata(metadata);
    }

    // Generate product image URL
    const protocol = request.headers.get('x-forwarded-proto') || 
                     (request.url.startsWith('https') ? 'https' : 'http');
    const host = request.headers.get('host') || 'localhost:3000';
    const productImageUrl = savedFilename 
      ? `${protocol}://${host}/api/images/${savedFilename}`
      : productDetails.productImageUrl;

    // Return exactly 4 fields as requested
    return NextResponse.json({
      success: true,
      imageUrl: productImageUrl,                          // 1. Image URL (saved image or Flipkart URL)
      productUrl: productDetails.productUrl,              // 2. Actual Flipkart product URL
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

