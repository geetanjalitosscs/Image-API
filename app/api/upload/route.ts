import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { put } from '@vercel/blob';

interface FlipkartProductDetails {
  productName: string;
  productDescription: string;
  productImageUrl: string;
  productUrl: string;
}

interface ImageMetadata {
  filename: string;
  flipkartUrl?: string;
  productName?: string;
  productDescription?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';
const METADATA_FILE = path.join(process.cwd(), 'public', 'uploads', 'metadata.json');

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}

function generateUniqueFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  const sanitized = sanitizeFilename(baseName);
  const randomSuffix = randomBytes(8).toString('hex');
  return `${sanitized}_${randomSuffix}${ext}`;
}

function extractProductName(filename: string): string {
  // Extract product name from filename (everything before the last underscore and random suffix)
  // Example: "phone1_9712de3ac759785d.webp" -> "phone1"
  // Example: "product_name_abc123.jpg" -> "product name"
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  
  // Split by underscore and take all parts except the last one (which is the random suffix)
  const parts = baseName.split('_');
  if (parts.length > 1) {
    // Remove the last part (random suffix) and join the rest
    const productParts = parts.slice(0, -1);
    return productParts.join(' ').trim() || baseName;
  }
  
  // If no underscore, return the base name
  return baseName;
}

function getProductImageUrl(filename: string, request?: NextRequest): string {
  // Generate product image URL like: http://localhost:3000/api/images/filename.jpg
  if (request) {
    // Use request headers to get the host
    const protocol = request.headers.get('x-forwarded-proto') || 
                     (request.url.startsWith('https') ? 'https' : 'http');
    const host = request.headers.get('host') || 'localhost:3000';
    return `${protocol}://${host}/api/images/${filename}`;
  }
  // Fallback for local development
  const protocol = process.env.NEXT_PUBLIC_PROTOCOL || 'http';
  const host = process.env.NEXT_PUBLIC_HOST || 'localhost:3000';
  return `${protocol}://${host}/api/images/${filename}`;
}

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

    // Extract product description
    let productDescription = '';
    const descPatterns = [
      /<div[^>]*class="[^"]*_1mXcCf[^"]*"[^>]*>(.*?)<\/div>/is,
      /<div[^>]*class="[^"]*RmoJUa[^"]*"[^>]*>(.*?)<\/div>/is,
      /<p[^>]*class="[^"]*_2-N8zT[^"]*"[^>]*>(.*?)<\/p>/is,
      /"description":"([^"]+)"/i,
    ];

    for (const pattern of descPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        productDescription = match[1].replace(/<[^>]*>/g, '').trim();
        if (productDescription && productDescription.length > 20) break;
      }
    }

    // Extract product image URL
    let productImageUrl = '';
    const imagePatterns = [
      /<img[^>]*class="[^"]*q6DClP[^"]*"[^>]*src="([^"]+)"/i,
      /<img[^>]*class="[^"]*_396cs4[^"]*"[^>]*src="([^"]+)"/i,
      /"image":"([^"]+)"/i,
      /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i,
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
          break;
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
    const formData = await request.formData();
    const files = formData.getAll('images') as File[];
    const flipkartUrl = formData.get('flipkartUrl') as string | null;
    
    // Extract Flipkart product details if URL is provided
    let flipkartDetails: FlipkartProductDetails | null = null;
    if (flipkartUrl && flipkartUrl.trim()) {
      console.log('Extracting Flipkart product details from:', flipkartUrl);
      flipkartDetails = await extractFlipkartProductDetails(flipkartUrl.trim());
      if (flipkartDetails) {
        console.log('Extracted product details:', flipkartDetails);
      } else {
        console.warn('Failed to extract Flipkart product details');
      }
    }

    console.log('Received files count:', files.length);

    if (files.length === 0) {
      console.error('No files in formData');
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const uploadedFiles: Array<{
      filename: string;
      productName: string;
      productImageUrl: string;
      flipkartUrl?: string;
      productDescription?: string;
    }> = [];
    const errors: string[] = [];

    for (const file of files) {
      console.log(`Processing file: ${file.name}, type: ${file.type}, size: ${file.size}`);

      if (!(file instanceof File)) {
        console.error(`Invalid file object: ${typeof file}`);
        errors.push('Invalid file object');
        continue;
      }

      const fileType = file.type.toLowerCase();
      const fileExt = path.extname(file.name).toLowerCase();
      
      // Check both MIME type and file extension
      const isValidType = ALLOWED_TYPES.includes(fileType) || 
                         (fileType === '' && ALLOWED_EXTENSIONS.includes(fileExt)) ||
                         ALLOWED_EXTENSIONS.includes(fileExt);
      
      console.log(`File type check: MIME=${fileType}, Ext=${fileExt}, Valid=${isValidType}`);

      if (!isValidType) {
        const errorMsg = `${file.name}: Invalid file type (MIME: ${fileType || 'unknown'}, Ext: ${fileExt}). Only JPG, PNG, and WEBP are allowed.`;
        console.error(errorMsg);
        errors.push(errorMsg);
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: File size exceeds 10MB limit.`);
        continue;
      }

      if (file.size === 0) {
        errors.push(`${file.name}: File is empty.`);
        continue;
      }

      try {
        const bytes = await file.arrayBuffer();
        const uniqueFilename = generateUniqueFilename(file.name);

        // Use Flipkart product name if available, otherwise extract from filename
        const productName = flipkartDetails?.productName || extractProductName(uniqueFilename);
        const productDescription = flipkartDetails?.productDescription;
        
        if (IS_VERCEL) {
          if (!process.env.BLOB_READ_WRITE_TOKEN) {
            errors.push(`${file.name}: Vercel Blob storage not configured. Please set BLOB_READ_WRITE_TOKEN environment variable in Vercel project settings.`);
            continue;
          }
          try {
            const blob = await put(uniqueFilename, bytes, {
              access: 'public',
              contentType: file.type,
            });
            const savedFilename = blob.pathname.split('/').pop() || uniqueFilename;
            const productImageUrl = getProductImageUrl(savedFilename, request);
            
            // Save metadata if Flipkart details are available
            if (flipkartDetails) {
              const metadata = await loadMetadata();
              metadata[savedFilename] = {
                filename: savedFilename,
                flipkartUrl: flipkartDetails.productUrl,
                productName: flipkartDetails.productName,
                productDescription: flipkartDetails.productDescription
              };
              await saveMetadata(metadata);
            }
            
            uploadedFiles.push({
              filename: savedFilename,
              productName: productName,
              productImageUrl: productImageUrl,
              flipkartUrl: flipkartDetails?.productUrl,
              productDescription: productDescription
            });
          } catch (blobError) {
            const errorMsg = blobError instanceof Error ? blobError.message : String(blobError);
            console.error(`Vercel Blob error for ${file.name}:`, errorMsg);
            errors.push(`${file.name}: Failed to upload to Vercel Blob - ${errorMsg}`);
          }
        } else {
          if (!existsSync(UPLOAD_DIR)) {
            await mkdir(UPLOAD_DIR, { recursive: true });
          }
          const buffer = Buffer.from(bytes);
          const filePath = path.join(UPLOAD_DIR, uniqueFilename);
          await writeFile(filePath, buffer);
          const productImageUrl = getProductImageUrl(uniqueFilename, request);
          
          // Save metadata if Flipkart details are available
          if (flipkartDetails) {
            const metadata = await loadMetadata();
            metadata[uniqueFilename] = {
              filename: uniqueFilename,
              flipkartUrl: flipkartDetails.productUrl,
              productName: flipkartDetails.productName,
              productDescription: flipkartDetails.productDescription
            };
            await saveMetadata(metadata);
          }
          
          uploadedFiles.push({
            filename: uniqueFilename,
            productName: productName,
            productImageUrl: productImageUrl,
            flipkartUrl: flipkartDetails?.productUrl,
            productDescription: productDescription
          });
        }
      } catch (error) {
        const errorDetails = error instanceof Error ? error.message : String(error);
        console.error(`Error uploading ${file.name}:`, errorDetails);
        errors.push(`${file.name}: Failed to save file - ${errorDetails}`);
      }
    }

    console.log(`Upload complete - Success: ${uploadedFiles.length}, Errors: ${errors.length}`);

    if (uploadedFiles.length === 0) {
      console.error('No files uploaded successfully. Errors:', errors);
      return NextResponse.json(
        { error: 'No files were uploaded', errors },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      uploaded: uploadedFiles.length,
      products: uploadedFiles.map(file => ({
        productName: file.productName,
        productImageUrl: file.productImageUrl,
        flipkartUrl: file.flipkartUrl,
        productDescription: file.productDescription
      })),
      files: uploadedFiles.map(file => file.filename),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
