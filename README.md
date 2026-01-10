# Image Upload API

Image upload and retrieval application built with Next.js.

## Features

- Upload multiple images (JPG, PNG, WEBP)
- View all uploaded images in a gallery
- View individual images with details
- API endpoints for image management
- Works on both local development and Vercel

## Setup

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Run development server:
```bash
npm run dev
```

3. Access the application:
- Home: `http://localhost:3000`
- Upload: `http://localhost:3000/upload`
- Gallery: `http://localhost:3000/images`

### Vercel Deployment

1. Push code to GitHub/GitLab/Bitbucket

2. Import project to Vercel

3. Vercel will automatically:
   - Detect Next.js
   - Install dependencies
   - Set up Vercel Blob Storage (if not already configured)

4. **Important**: Enable Vercel Blob Storage:
   - Go to your Vercel project settings
   - Navigate to "Storage" tab
   - Create a new Blob store (if not exists)
   - The `BLOB_READ_WRITE_TOKEN` will be automatically available

5. Deploy!

## API Endpoints

- `POST /api/upload` - Upload images
- `GET /api/images` - Get all image URLs
- `GET /api/images/[filename]` - Get individual image

## How It Works

- **Local**: Images are stored in `/public/uploads` directory
- **Vercel**: Images are stored in Vercel Blob Storage automatically

The application automatically detects the environment and uses the appropriate storage method.


