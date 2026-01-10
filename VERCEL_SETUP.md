# Vercel Blob Storage Setup Guide

## Problem
Error: "Vercel Blob storage not configured. Please set BLOB_READ_WRITE_TOKEN environment variable"

## Solution: Setup Vercel Blob Storage

### Method 1: Using Vercel Dashboard (Recommended)

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Select your project: `image-api-kappa-nine`

2. **Create Blob Storage**
   - Click on your project
   - Go to **Storage** tab (in the top menu)
   - Click **"Create Database"** button
   - Select **"Blob"** from the options
   - Click **"Create"**
   - Vercel will automatically create the Blob store and set `BLOB_READ_WRITE_TOKEN`

3. **Verify Environment Variable**
   - Go to **Settings** → **Environment Variables**
   - You should see `BLOB_READ_WRITE_TOKEN` automatically added
   - If not visible, it's still set internally by Vercel

4. **Redeploy**
   - Go to **Deployments** tab
   - Click **"Redeploy"** on the latest deployment
   - OR push a new commit to trigger redeploy

### Method 2: Manual Token Setup (If Method 1 doesn't work)

1. **Get Blob Store Token**
   - Go to **Storage** tab
   - Click on your Blob store
   - Go to **Settings**
   - Copy the **Read/Write Token**

2. **Add Environment Variable**
   - Go to **Settings** → **Environment Variables**
   - Click **"Add New"**
   - Name: `BLOB_READ_WRITE_TOKEN`
   - Value: Paste the token you copied
   - Select environments: **Production**, **Preview**, **Development**
   - Click **"Save"**

3. **Redeploy**
   - Go to **Deployments** tab
   - Click **"Redeploy"**

## Verification

After setup, try uploading an image again. The error should be gone.

## Important Notes

- Vercel Blob Storage is required for file uploads on Vercel
- Local development uses file system (no token needed)
- The token is automatically available in Vercel environment after Blob store creation
