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

    // Fetch the Flipkart product page
    const response = await fetch(flipkartUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch Flipkart page:', response.status);
      return null;
    }

    const html = await response.text();
    
    // Extract product name - Look for various possible selectors
    let productName = '';
    const namePatterns = [
      /<h1[^>]*class="[^"]*B_NuCI[^"]*"[^>]*>(.*?)<\/h1>/i,
      /<span[^>]*class="[^"]*B_NuCI[^"]*"[^>]*>(.*?)<\/span>/i,
      /<h1[^>]*>(.*?)<\/h1>/i,
      /"productName":"([^"]+)"/i,
      /<title>(.*?)\s*-\s*Flipkart<\/title>/i,
    ];

    for (const pattern of namePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        productName = match[1].replace(/<[^>]*>/g, '').trim();
        if (productName) break;
      }
    }

    // Extract product description - Try multiple patterns
    let productDescription = '';
    const descPatterns = [
      // Try JSON-LD structured data
      /"description"\s*:\s*"([^"]+)"/i,
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
    const imagePatterns = [
      // Try JSON-LD structured data first
      /"image"\s*:\s*"([^"]+)"/i,
      /"imageUrl"\s*:\s*"([^"]+)"/i,
      // Try meta tags
      /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i,
      /<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"/i,
      // Try img tags with specific classes
      /<img[^>]*class="[^"]*q6DClP[^"]*"[^>]*src="([^"]+)"/i,
      /<img[^>]*class="[^"]*_396cs4[^"]*"[^>]*src="([^"]+)"/i,
      /<img[^>]*class="[^"]*CXW8mj[^"]*"[^>]*src="([^"]+)"/i,
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
          if (productImageUrl.includes('flipkart') || productImageUrl.includes('img')) {
            break;
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
      productUrl: flipkartUrl,
    };
  } catch (error) {
    console.error('Error extracting Flipkart product details:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { flipkartUrl } = body;

    if (!flipkartUrl || !flipkartUrl.trim()) {
      return NextResponse.json(
        { error: 'Flipkart URL is required' },
        { status: 400 }
      );
    }

    console.log('Extracting Flipkart product details from:', flipkartUrl);
    const productDetails = await extractFlipkartProductDetails(flipkartUrl.trim());

    if (!productDetails) {
      return NextResponse.json(
        { error: 'Failed to extract product details from Flipkart URL' },
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

