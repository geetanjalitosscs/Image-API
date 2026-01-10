import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { put } from '@vercel/blob';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';

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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('images') as File[];

    console.log('Received files count:', files.length);

    if (files.length === 0) {
      console.error('No files in formData');
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const uploadedFiles: string[] = [];
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
            uploadedFiles.push(blob.pathname.split('/').pop() || uniqueFilename);
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
          uploadedFiles.push(uniqueFilename);
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
      files: uploadedFiles,
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
