import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { list } from '@vercel/blob';

interface ImageMetadata {
  filename: string;
  productUrl?: string;
  productName?: string;
  productDescription?: string;
}

const METADATA_FILE = path.join(process.cwd(), 'public', 'uploads', 'metadata.json');

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function isValidImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
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
      await require('fs/promises').mkdir(dir, { recursive: true });
    }
    await writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving metadata:', error);
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    if (IS_VERCEL) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.warn('BLOB_READ_WRITE_TOKEN not configured, returning empty list');
        return NextResponse.json({ 
          success: true,
          count: 0,
          images: [] 
        });
      }
      try {
        // List all blobs with higher limit to get all images
        let allBlobs: any[] = [];
        let cursor: string | undefined = undefined;
        
        // Fetch all blobs with pagination
        do {
          const result: { blobs: any[]; cursor?: string } = await list({ limit: 1000, cursor });
          allBlobs = allBlobs.concat(result.blobs);
          cursor = result.cursor;
        } while (cursor);
        
        console.log('Total blobs found:', allBlobs.length);
        console.log('Blob samples:', allBlobs.slice(0, 3).map(b => ({ pathname: b.pathname, url: b.url })));
        
        const metadata = await loadMetadata();
        
        const imageFiles = await Promise.all(
          allBlobs
            .filter(blob => {
              const ext = path.extname(blob.pathname).toLowerCase();
              return ALLOWED_EXTENSIONS.includes(ext);
            })
            .map(async (blob) => {
            // Extract filename from pathname (handle both /filename and filename formats)
            const fullPathname = blob.pathname.split('/').pop() || blob.pathname;
            // Vercel adds a suffix like -WkGu3YCeBTxMX6HA3kd8bwXAGHXvMy, so extract base filename
            // Format: filename-randomSuffix.jpg -> filename.jpg
            const pathExt = path.extname(fullPathname);
            const baseName = path.basename(fullPathname, pathExt);
            // Remove Vercel suffix (everything after last hyphen that looks like a token - 32 char alphanumeric)
            let filename = fullPathname;
            if (baseName.includes('-')) {
              const parts = baseName.split('-');
              const lastPart = parts[parts.length - 1];
              // Check if last part looks like a Vercel token (32 chars, alphanumeric)
              if (lastPart && lastPart.length === 32 && /^[a-zA-Z0-9]+$/.test(lastPart)) {
                // Remove the last part (token) and reconstruct filename
                const baseFilename = parts.slice(0, -1).join('-');
                filename = baseFilename + pathExt;
              }
            }
            
            // Get file extension to determine content type
            const ext = path.extname(filename).toLowerCase();
            const contentType = 
              ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
              ext === '.png' ? 'image/png' :
              ext === '.webp' ? 'image/webp' :
              null;
            
            // Get metadata for this file - try both full pathname and base filename
            let fileMetadata = metadata[filename] || metadata[fullPathname] || {};
            
            // If productUrl not found, try to find it by matching base filename (without random suffix)
            if (!fileMetadata.productUrl) {
              const baseName = filename.replace(ext, '');
              const baseParts = baseName.split('_');
              if (baseParts.length > 1) {
                // Try to find metadata entry with same base name (different random suffix)
                const matchingKey = Object.keys(metadata).find(key => {
                  const keyExt = path.extname(key);
                  const keyBaseName = key.replace(keyExt, '');
                  const keyParts = keyBaseName.split('_');
                  if (keyParts.length > 1 && baseParts.length > 1) {
                    // Compare all parts except the last one (random suffix)
                    const keyBase = keyParts.slice(0, -1).join('_');
                    const filenameBase = baseParts.slice(0, -1).join('_');
                    return keyBase === filenameBase;
                  }
                  return false;
                });
                
                if (matchingKey && metadata[matchingKey]?.productUrl) {
                  fileMetadata = { ...fileMetadata, ...metadata[matchingKey] };
                }
              }
            }
            
            // Use product name if available, otherwise extract from filename
            const productName = fileMetadata.productName || extractProductName(filename);
            
            // If still no productUrl, try to find it by matching productName in all metadata
            let productUrl = fileMetadata.productUrl || null;
            if (!productUrl && productName) {
              // Search all metadata entries for matching productName
              const matchingEntry = Object.values(metadata).find(entry => 
                entry.productName && 
                entry.productName.toLowerCase().trim() === productName.toLowerCase().trim() &&
                entry.productUrl
              );
              
              if (matchingEntry?.productUrl) {
                productUrl = matchingEntry.productUrl;
                // Update metadata with found URL
                const updatedMetadata = await loadMetadata();
                if (!updatedMetadata[filename]) {
                  updatedMetadata[filename] = { filename };
                }
                updatedMetadata[filename].productUrl = productUrl;
                await saveMetadata(updatedMetadata);
                fileMetadata.productUrl = productUrl;
              }
            }
            
            // If still no productUrl, try to extract from description
            if (!productUrl) {
              const description = fileMetadata.productDescription || `Image uploaded on ${new Date((blob as any).uploadedAt || Date.now()).toLocaleDateString()}`;
              // Try to find URL in description
              const urlMatch = description.match(/https?:\/\/[^\s\)]+/i);
              if (urlMatch && urlMatch[0]) {
                productUrl = urlMatch[0].trim();
                // Update metadata with found URL
                if (productUrl) {
                  const updatedMetadata = await loadMetadata();
                  if (!updatedMetadata[filename]) {
                    updatedMetadata[filename] = { filename };
                  }
                  updatedMetadata[filename].productUrl = productUrl;
                  await saveMetadata(updatedMetadata);
                  fileMetadata.productUrl = productUrl;
                }
              }
            }
            const productImageUrl = getProductImageUrl(filename, request);
            
            // Return complete image data in specified order
            const title = filename.replace(ext, '').replace(/_/g, ' ').trim() || 'Untitled Image';
            const description = fileMetadata.productDescription || `Image uploaded on ${new Date((blob as any).uploadedAt || Date.now()).toLocaleDateString()}`;
            
            return {
              filename: filename,
              productName: productName,
              title: title,
              productUrl: productUrl,
              productImageUrl: productImageUrl,
              description: description,
              uploadedAt: (blob as any).uploadedAt || null,
            };
            })
        );
        
        // Sort after Promise.all resolves
        imageFiles.sort((a, b) => a.title.localeCompare(b.title));
        
        console.log('Filtered image files:', imageFiles.length);
        return NextResponse.json({ 
          success: true,
          count: imageFiles.length,
          images: imageFiles
        }, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
      } catch (error) {
        console.error('Error listing blobs:', error);
        return NextResponse.json({ 
          success: false,
          count: 0,
          images: [],
          error: error instanceof Error ? error.message : 'Failed to list images'
        });
      }
    } else {
      if (!existsSync(UPLOAD_DIR)) {
        return NextResponse.json({ 
          success: true,
          count: 0,
          images: [] 
        });
      }

      const metadata = await loadMetadata();
      const files = await readdir(UPLOAD_DIR);
      const imageFiles = await Promise.all(
        files
          .filter(file => isValidImageFile(file))
          .map(async (file) => {
          const filePath = path.join(UPLOAD_DIR, file);
          const stats = existsSync(filePath) ? require('fs').statSync(filePath) : null;
          const ext = path.extname(file).toLowerCase();
          const contentType = 
            ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
            ext === '.png' ? 'image/png' :
            ext === '.webp' ? 'image/webp' :
            null;
          
          // Get metadata for this file
          let fileMetadata = metadata[file] || {};
          
          // If productUrl not found, try to find it by matching base filename (without random suffix)
          if (!fileMetadata.productUrl) {
            const baseName = file.replace(ext, '');
            const baseParts = baseName.split('_');
            if (baseParts.length > 1) {
              // Try to find metadata entry with same base name (different random suffix)
              const matchingKey = Object.keys(metadata).find(key => {
                const keyExt = path.extname(key);
                const keyBaseName = key.replace(keyExt, '');
                const keyParts = keyBaseName.split('_');
                if (keyParts.length > 1 && baseParts.length > 1) {
                  // Compare all parts except the last one (random suffix)
                  const keyBase = keyParts.slice(0, -1).join('_');
                  const filenameBase = baseParts.slice(0, -1).join('_');
                  return keyBase === filenameBase;
                }
                return false;
              });
              
              if (matchingKey && metadata[matchingKey]?.productUrl) {
                fileMetadata = { ...fileMetadata, ...metadata[matchingKey] };
              }
            }
          }
          
          // Use product name if available, otherwise extract from filename
          const productName = fileMetadata.productName || extractProductName(file);
          
          // If still no productUrl, try to find it by matching productName in all metadata
          let productUrl = fileMetadata.productUrl || null;
          if (!productUrl && productName) {
            // Search all metadata entries for matching productName
            const matchingEntry = Object.values(metadata).find(entry => 
              entry.productName && 
              entry.productName.toLowerCase().trim() === productName.toLowerCase().trim() &&
              entry.productUrl
            );
            
            if (matchingEntry?.productUrl) {
              productUrl = matchingEntry.productUrl;
              // Update metadata with found URL
              const updatedMetadata = await loadMetadata();
              if (!updatedMetadata[file]) {
                updatedMetadata[file] = { filename: file };
              }
              updatedMetadata[file].productUrl = productUrl;
              await saveMetadata(updatedMetadata);
              fileMetadata.productUrl = productUrl;
            }
          }
          
          // If still no productUrl, try to extract from description
          if (!productUrl) {
            const description = fileMetadata.productDescription || (stats ? `Image uploaded on ${new Date(stats.mtime).toLocaleDateString()}` : 'Image');
            // Try to find URL in description
            const urlMatch = description.match(/https?:\/\/[^\s\)]+/i);
            if (urlMatch && urlMatch[0]) {
              productUrl = urlMatch[0].trim();
              // Update metadata with found URL
              if (productUrl) {
                const updatedMetadata = await loadMetadata();
                if (!updatedMetadata[file]) {
                  updatedMetadata[file] = { filename: file };
                }
                updatedMetadata[file].productUrl = productUrl;
                await saveMetadata(updatedMetadata);
                fileMetadata.productUrl = productUrl;
              }
            }
          }
          const productImageUrl = getProductImageUrl(file, request);
          
          // Return complete image data in specified order
          const title = file.replace(ext, '').replace(/_/g, ' ').trim() || 'Untitled Image';
          const description = fileMetadata.productDescription || (stats ? `Image uploaded on ${new Date(stats.mtime).toLocaleDateString()}` : 'Image');
          
          return {
            filename: file,
            productName: productName,
            title: title,
            productUrl: productUrl,
            productImageUrl: productImageUrl,
            description: description,
            uploadedAt: stats ? stats.mtime.toISOString() : null,
          };
          })
      );
      
      // Sort after Promise.all resolves
      imageFiles.sort((a, b) => a.title.localeCompare(b.title));

      return NextResponse.json({ 
        success: true,
        count: imageFiles.length,
        images: imageFiles
      });
    }
  } catch (error) {
    console.error('Error reading images:', error);
    return NextResponse.json(
      { error: 'Failed to fetch images' },
      { status: 500 }
    );
  }
}
