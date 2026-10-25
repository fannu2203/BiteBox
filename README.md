# Bite Box

Bite Box is a MERN food marketplace based on the supplied product brief. It has a React and Tailwind storefront, role-specific workspaces, and an Express/Mongoose API organized with MVC controllers, models, and routes.

## Local setup

Requirements: Node.js 20 or later and MongoDB 7 or a MongoDB Atlas URI.

1. Copy `.env.example` to `server/.env` and set `MONGODB_URI`, `JWT_SECRET`, a strong `ADMIN_PASSWORD`, and the three Cloudinary values (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`). Keep the Cloudinary API secret only in `server/.env`; never add it to the React client or commit it. The first API start creates the one admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Set those values before the first start; changing them later does not reset the existing account.
2. Install packages from the project root:

   ```powershell
   npm install
   npm install --prefix server
   npm install --prefix client
   ```

3. Start both apps:

   ```powershell
   npm run dev
   ```

   The storefront runs at `http://localhost:5173`; the API runs at `http://localhost:5000`. For separate terminals, run `npm run dev --prefix server` and `npm run dev --prefix client`.

For a deployed client, set `VITE_API_URL` to the API base URL, such as `https://api.example.com/api`. Set `CLIENT_URL` on the API to the permitted client origin. Never commit real environment files or production credentials.

## Implemented workflows

- **Customer:** browse and search kitchens or dishes without an account, view out-of-stock items, add dishes to a single-kitchen cart, sign in by email or phone, enter delivery distance, see the price breakdown, choose COD/JazzCash/EasyPaisa, follow order status and rider coordinates, and submit feedback after delivery.
- **Vendor:** request an account with owner, shop, license, utility-bill, payment-proof, and payout details; wait for admin payment verification and approval; add/edit/delete dishes, upload images, set descriptions, discounts and stock, hide unavailable items, accept/reject orders, mark preparation complete, review sales, and request balance top-ups.
- **Rider:** submit identity, address, account, vehicle, registration, utility-bill and license details; wait for admin approval; set location, view ready orders within the configured radius, claim deliveries, update delivery status, share browser location during a delivery, submit customer collections with proof references, and request weekly earnings payout.
- **Admin:** overview analytics and order export, vendor payment verification and rider approval, account suspension/reactivation challans/password resets, payment destination management, order search/date filters/cancellation, payment verification, feedback and support review, dated notifications, configurable brand/commission/delivery/top-up/radius/challan settings, sales and financial record CSV exports, and five-year record retention cleanup.
- **Terms:** a generated Terms & Conditions page is available at `/terms`.

## Pricing and settlement defaults

The attached formula is implemented as:

```text
delivery fee = distance in km × Rs. 10
brand commission = min(food subtotal × 17%, commission cap)
customer total = food subtotal + delivery fee + brand commission
rider earnings = delivery fee + 10% of brand commission
```

The admin can change the commission cap, delivery rate, vendor top-up threshold, minimum vendor balance, rider radius, and reactivation challan amount. The cap and challan amount were unspecified in the brief, so they are configurable; the challan amount must be set before generating a reactivation challan. The order form asks for distance because no geocoding provider was specified.

## Project structure

```text
client/src/pages/       Storefront, auth, role portal, terms
client/src/components/  Shared navigation, brand, modal, toast, icons
client/src/context/     Auth state and session persistence
server/src/models/      User, Product, Order, Record, DocumentAsset
server/src/controllers/ MVC request handling and business workflows
server/src/routes/      Role-protected API routes
server/src/services/    Notifications and business helpers
```

## Integration notes

The app records JazzCash/EasyPaisa/COD selections, transfer references, payment proofs, collections, and admin verification. It does not initiate real wallet or bank transfers; connect a licensed payment provider and confirm callbacks before production use. Rider browser geolocation updates order coordinates, with an OpenStreetMap embed for customer tracking; production deployment should configure HTTPS, user consent and location retention. Product, vendor, and platform images are uploaded to Cloudinary as public image assets. Signup and profile documents are uploaded as authenticated Cloudinary assets; the database stores their asset IDs and metadata, and owners/admins receive five-minute signed download links after authorization. The API accepts JPG, PNG, WEBP, AVIF, and PDF files up to 10 MB. Configure Cloudinary credentials in `server/.env` before using uploads; the API returns a clear configuration error if they are missing. The Terms page should receive local legal review and be paired with a privacy notice before collecting real identity documents or payment information.

Admin demo sign-up is intentionally absent. Create the first admin from environment variables. Vendor/rider application status is pending until admin review; vendor approval requires a signup payment reference and proof to be verified first.
