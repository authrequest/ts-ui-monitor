import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const HOME_URL = process.env.UNIFI_HOME_URL || 'https://store.ui.com/us/en';
const PRODUCTS_FILE = path.resolve(__dirname, 'products.json');

let knownProducts: Record<string, Product> = {};

interface ProductVariant {
  id: string;
  displayPrice: {
    amount: number;
    currency: string;
  };
}

interface Product {
  id: string;
  title: string;
  shortDescription: string;
  slug: string;
  thumbnail: { url: string };
  variants: ProductVariant[];
}

// Load known products from products.json
function loadKnownProducts() {
  if (fs.existsSync(PRODUCTS_FILE)) {
    try {
      const data = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
      const products = JSON.parse(data);
      for (const product of products) {
        knownProducts[product.id] = product;
      }
      // console.log(`Loaded ${Object.keys(knownProducts).length} known products`); // Debug
    } catch (err) {
      console.error('Failed to load products.json:', err);
    }
  }
}

// Save all known products to products.json
function saveKnownProducts() {
  console.log(`Saving ${Object.keys(knownProducts).length} known products`);
  const allProducts: Product[] = Object.values(knownProducts).map((p: any) => ({
    id: p.id,
    title: p.title,
    shortDescription: p.shortDescription,
    slug: p.slug,
    thumbnail: {
      url: p.thumbnail?.url || ""
    },
    variants: (p.variants || []).map((v: any) => ({
      id: v.id,
      displayPrice: {
        amount: v.displayPrice?.amount,
        currency: v.displayPrice?.currency || "USD"
      }
    }))
  }));
  console.log(allProducts);
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(allProducts, null, 2));
}

// Util: Fetch build ID from Unifi store HTML
async function fetchBuildID(): Promise<string> {
  try {
    const html = (await axios.get(HOME_URL)).data as string;
    const match = html.match(/https:\/\/[^/]+\/_next\/static\/([a-zA-Z0-9]+)\/_ssgManifest\.js/);
    if (!match) throw new Error('Build ID not found in HTML response');
    return match[1];
  } catch (error) {
    console.error('Error fetching build ID:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// Util: Fetch products for a category
async function fetchProducts(buildID: string, category: string): Promise<Product[]> {
  const url = `https://store.ui.com/_next/data/${buildID}/us/en.json?category=${category}&store=us&language=en`;
  try {
    const { data } = await axios.get(url);
    const subCategories = data?.pageProps?.subCategories || [];
    return subCategories.flatMap((sc: any) => sc.products || []);
  } catch (error) {
    console.error(`Error fetching products for category ${category}:`, 
      error instanceof Error ? error.message : String(error));
    return [];
  }
}

// POST endpoint to receive product data
app.post('/api/products', (req, res) => {
  // Here you would save to DB or file, but for demo just log
  res.status(201).json({ status: 'ok' });
});

// Periodic monitor loop
async function monitor(): Promise<void> {
  try {
    const buildID = await fetchBuildID();
    const categories = [
      'all-switching',
      'all-unifi-cloud-gateways',
      'all-wifi',
      'all-cameras-nvrs',
      'all-door-access',
      'all-cloud-keys-gateways',
      'all-power-tech',
      'all-integrations',
      'accessories-cables-dacs',
    ];
    let newProducts: any[] = [];
    for (const category of categories) {
      const products = await fetchProducts(buildID, category);
      for (const product of products) {
        if (!knownProducts[product.id]) {
          knownProducts[product.id] = product;
          newProducts.push(product);
          // POST to our own API
          console.log(`POSTing product: ${product.id}`);
          await axios.post(`http://localhost:${PORT}/api/products`, product);
        }
      }
    }
    if (newProducts.length > 0) {
      saveKnownProducts();
    }
  } catch (err) {
    console.error('Monitor error:', err instanceof Error ? err.message : String(err));
  } finally {
    // Ensure the next monitor run is scheduled even if this one fails
    setTimeout(monitor, 30 * 1000);
  }
}

// Load known products on startup
loadKnownProducts();

// Initial run
monitor();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
