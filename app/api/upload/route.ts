import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { put } from '@vercel/blob';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
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

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const uploadedFiles: string[] = [];
    const errors: string[] = [];

    for (const file of files) {
      if (!(file instanceof File)) {
        errors.push('Invalid file object');
        continue;
      }

      if (!ALLOWED_TYPES.includes(file.type.toLowerCase())) {
        errors.push(`${file.name}: Invalid file type. Only JPG, PNG, and WEBP are allowed.`);
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
        const buffer = Buffer.from(bytes);
        const uniqueFilename = generateUniqueFilename(file.name);

        if (IS_VERCEL) {
          const blob = await put(uniqueFilename, buffer, {
            access: 'public',
            contentType: file.type,
          });
          uploadedFiles.push(blob.pathname.split('/').pop() || uniqueFilename);
        } else {
          if (!existsSync(UPLOAD_DIR)) {
            await mkdir(UPLOAD_DIR, { recursive: true });
          }
          const filePath = path.join(UPLOAD_DIR, uniqueFilename);
          await writeFile(filePath, buffer);
          uploadedFiles.push(uniqueFilename);
        }
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
        errors.push(`${file.name}: Failed to save file.`);
      }
    }

    if (uploadedFiles.length === 0) {
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
