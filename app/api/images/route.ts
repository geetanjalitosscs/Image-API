import { NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function isValidImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

export async function GET() {
  try {
    if (!existsSync(UPLOAD_DIR)) {
      return NextResponse.json({ images: [] });
    }

    const files = await readdir(UPLOAD_DIR);
    const imageFiles = files
      .filter(file => isValidImageFile(file))
      .map(file => `/uploads/${file}`)
      .sort();

    return NextResponse.json({ images: imageFiles });
  } catch (error) {
    console.error('Error reading images:', error);
    return NextResponse.json(
      { error: 'Failed to fetch images' },
      { status: 500 }
    );
  }
}

