import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { put } from '@vercel/blob';

interface ProductDetails {
  productName: string;
  productDescription: string;
  productImageUrl: string;
  productUrl: string;
}

interface ImageMetadata {
  filename: string;
  productUrl?: string;
  productName?: string;
  productDescription?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';
const METADATA_FILE = path.join(process.cwd(), 'public', 'uploads', 'metadata.json');
const METADATA_BLOB_NAME = 'metadata.json'; // Name for metadata in Vercel Blob Storage

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


export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('images') as File[];
    const productUrl = formData.get('productUrl') as string | null;

    console.log('Received files count:', files.length);

    if (files.length === 0) {
      console.error('No files in formData');
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const uploadedFiles: Array<{
      filename: string;
      productName: string;
      productImageUrl: string;
      productUrl?: string;
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

        // Extract product name from filename
        const productName = extractProductName(uniqueFilename);
        const productDescription = undefined;
        
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
            // Use uniqueFilename for metadata key (Vercel might add suffix to pathname)
            const savedFilename = uniqueFilename;
            const productImageUrl = getProductImageUrl(savedFilename, request);
            
            // Always save metadata (even without productUrl) so we can match by productName later
            const metadata = await loadMetadata();
            metadata[savedFilename] = {
              filename: savedFilename,
              productUrl: productUrl && productUrl.trim() ? productUrl.trim() : undefined,
              productName: productName,
              productDescription: productDescription
            };
            await saveMetadata(metadata);
            
            uploadedFiles.push({
              filename: savedFilename,
              productName: productName,
              productImageUrl: productImageUrl,
              productUrl: productUrl?.trim(),
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
          
          // Always save metadata (even without productUrl) so we can match by productName later
          const metadata = await loadMetadata();
          metadata[uniqueFilename] = {
            filename: uniqueFilename,
            productUrl: productUrl && productUrl.trim() ? productUrl.trim() : undefined,
            productName: productName,
            productDescription: productDescription
          };
          await saveMetadata(metadata);
          
          uploadedFiles.push({
            filename: uniqueFilename,
            productName: productName,
            productImageUrl: productImageUrl,
            productUrl: productUrl?.trim(),
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
        productUrl: file.productUrl,
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
