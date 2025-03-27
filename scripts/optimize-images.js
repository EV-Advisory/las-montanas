const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Configure Sharp for better performance in Netlify's environment
sharp.cache(false); // Disable cache to reduce memory usage
sharp.concurrency(1); // Reduce concurrency to prevent memory issues

// Set max memory allocation for Sharp (helps on Netlify)
process.env.SHARP_MEMORY_ALLOCATION = 512; // 512MB

// Directories to scan for images (make paths work in both local and Netlify environments)
const staticDirectories = [
  path.resolve(process.cwd(), 'static/images'),
  path.resolve(process.cwd(), 'static/img')
];

// Log the environment
console.log('Current working directory:', process.cwd());
console.log('Node version:', process.version);
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Netlify environment:', process.env.NETLIFY ? 'Yes' : 'No');

// Supported image formats
const IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.gif'];

// Image sizes for responsive images (reduce for Netlify builds)
const SIZES = [320, 640, 1200];

// Quality settings based on size
const getQuality = (size) => {
  if (size <= 320) return 75;
  if (size <= 640) return 80;
  return 85;
};

// Get all files in a directory recursively
async function getFiles(dir) {
  try {
    if (!fs.existsSync(dir)) {
      console.log(`Directory doesn't exist: ${dir}`);
      return [];
    }
    
    const subdirs = await readdir(dir);
    const files = await Promise.all(
      subdirs.map(async (subdir) => {
        const res = path.resolve(dir, subdir);
        try {
          const stats = await stat(res);
          return stats.isDirectory() ? getFiles(res) : res;
        } catch (err) {
          console.warn(`Error processing ${res}:`, err.message);
          return [];
        }
      })
    );
    return files.flat();
  } catch (err) {
    console.warn(`Error reading directory ${dir}:`, err.message);
    return [];
  }
}

// Is this an image we should process?
function isImage(file) {
  const ext = path.extname(file).toLowerCase();
  return IMAGE_FORMATS.includes(ext);
}

// Convert an image to different formats and sizes
async function processImage(imagePath) {
  try {
    const filename = path.basename(imagePath, path.extname(imagePath));
    const directory = path.dirname(imagePath);
    
    // Only process if the image doesn't already have optimized versions
    const outputWebpPath = path.join(directory, `${filename}.webp`);
    if (fs.existsSync(outputWebpPath)) {
      console.log(`Skipping ${imagePath} - already processed`);
      return;
    }
    
    console.log(`Processing ${imagePath}`);
    
    // Create base WebP version with a timeout to prevent hanging
    let image;
    try {
      image = sharp(imagePath);
      const metadata = await Promise.race([
        image.metadata(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Metadata timeout')), 10000)
        )
      ]);
      
      // Don't process images that are already small
      if (metadata.width <= 320 && metadata.height <= 320) {
        console.log(`Skipping small image ${imagePath}`);
        return;
      }
      
      // Create WebP version at original size
      await image
        .webp({ quality: 85, effort: 4 }) // Lower effort level for faster processing
        .toFile(outputWebpPath);
        
      // Create resized versions only for larger images
      if (metadata.width > 640) {
        // Limit to 2 sizes for Netlify to reduce build time
        const targetSizes = SIZES.filter(size => size < metadata.width).slice(0, 2);
        
        // Process one size at a time to avoid memory issues
        for (const size of targetSizes) {
          const quality = getQuality(size);
          
          // Create resized WebP
          const resizedWebpPath = path.join(directory, `${filename}-${size}.webp`);
          await sharp(imagePath)
            .resize({ width: size, withoutEnlargement: true })
            .webp({ quality, effort: 4 })
            .toFile(resizedWebpPath);
            
          // Force garbage collection if possible
          if (global.gc) {
            global.gc();
          }
        }
      }
    } catch (error) {
      console.error(`Error processing image ${imagePath}:`, error.message);
    }
  } catch (error) {
    console.error(`Error in processImage for ${imagePath}:`, error.message);
  }
}

// Main function
async function main() {
  try {
    // Create output directories if they don't exist
    for (const dir of staticDirectories) {
      if (!fs.existsSync(dir)) {
        console.log(`Creating directory ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    
    // Find and process all images
    let totalImages = 0;
    let processedImages = 0;
    
    for (const dir of staticDirectories) {
      try {
        if (fs.existsSync(dir)) {
          const files = await getFiles(dir);
          const imageFiles = files.filter(isImage);
          
          totalImages += imageFiles.length;
          console.log(`Found ${imageFiles.length} images in ${dir}`);
          
          // Process images one at a time for Netlify to avoid memory issues
          const BATCH_SIZE = process.env.NETLIFY ? 1 : 3;
          
          for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
            const batch = imageFiles.slice(i, i + BATCH_SIZE);
            
            // Log progress
            console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(imageFiles.length/BATCH_SIZE)}`);
            
            // Process batch
            if (process.env.NETLIFY) {
              // Sequential processing for Netlify
              for (const image of batch) {
                await processImage(image);
                processedImages++;
                console.log(`Progress: ${processedImages}/${totalImages} (${Math.round(processedImages/totalImages*100)}%)`);
              }
            } else {
              // Parallel processing for local
              await Promise.all(batch.map(processImage));
              processedImages += batch.length;
            }
            
            // Force garbage collection if possible
            if (global.gc) {
              global.gc();
            }
          }
        }
      } catch (err) {
        console.warn(`Error processing directory ${dir}:`, err.message);
      }
    }
    
    console.log(`Image optimization complete! Processed ${processedImages} of ${totalImages} images.`);
  } catch (error) {
    console.error('Error optimizing images:', error.message);
    // Don't exit with error code to prevent build failure
    console.log('Continuing with build despite image optimization errors');
  }
}

// Catch unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't fail the build
  console.log('Continuing with build despite unhandled rejection');
});

main().catch(err => {
  console.error('Uncaught error in main function:', err.message);
  console.log('Continuing with build despite errors');
}); 