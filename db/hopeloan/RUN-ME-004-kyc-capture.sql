/* THE SAME LINE, FOR THE SAME REASON. Not optional -- see RUN-ME-001's own note on this. */
set search_path = hopeloan, public;

/* =====================================================================================
   KYC CAPTURE -- ID TYPE, SIGNATURE, THUMBPRINT PRESS, AND THREE VERIFIED PLACES.
   =====================================================================================
   One message, several asks, all additive:

     "gender should be choice not filling"
     "ID too - choose type to fill wether NIDA, drivers, voters, passport etc"
     "residence and business ver should be filled street, ward, district for both customer
      and guarantor"
     "fill business name and capture live location coordinates for all 3 placess business
      and their residences"
     "at personal details is were i want to capture signature and biomentic fingerprints,
      and camera capture passportsize photo, also will capture these at guarantor section"
     "i mean they press the thumb on phone screen and we record the fingerprint or draw
      signature too llike how we work with phone notes apps" -- a canvas capture, the same
      mechanism for both, not a hardware fingerprint reader (there is no such API in a
      browser, and nothing in this app's Android bridge exposes one either).

   business_type, business_name, gender, national_id, tin, passport_no/_country,
   driving_licence, voters_id, other_id_type/_no, street, ward, district, photo_url --
   already columns on customers (RUN-ME-001). This file adds only what genuinely does not
   exist yet: which ID type was actually chosen, the two captures that are new (signature,
   thumbprint), and the three places' GPS + a verification photo for each. */

alter table customers add column if not exists id_type text;              -- NIDA | Driving Licence | Voters ID | Passport | Other
alter table customers add column if not exists signature_url text;        -- storage PATH, not a public URL -- see the bucket below
alter table customers add column if not exists thumbprint_url text;
alter table customers add column if not exists residence_lat numeric(10,7);
alter table customers add column if not exists residence_lng numeric(10,7);
alter table customers add column if not exists residence_verify_photo_url text;   -- officer + customer, AT the residence
alter table customers add column if not exists business_lat numeric(10,7);
alter table customers add column if not exists business_lng numeric(10,7);
alter table customers add column if not exists business_verify_photo_url text;    -- officer + customer, AT the business front

/* THE GUARANTOR'S OWN THREE CAPTURES, AND THE PLACE THEY LIVE.
   district, ward, occupation, national_id, photo_url already exist (RUN-ME-001) -- street was
   the one place-column customers had that guarantors did not.
   "guarantor id should be choices too.. not just nida" -- id_type records which kind was
   picked; the guarantor is not reported to the bureau per-type the way the customer is, so
   the number itself still lands in the one existing national_id column, whichever type it is. */
alter table guarantors add column if not exists id_type text;
alter table guarantors add column if not exists street text;
alter table guarantors add column if not exists signature_url text;
alter table guarantors add column if not exists thumbprint_url text;
alter table guarantors add column if not exists residence_lat numeric(10,7);
alter table guarantors add column if not exists residence_lng numeric(10,7);
alter table guarantors add column if not exists residence_verify_photo_url text;  -- officer + guarantor, AT the guarantor's residence

/* =====================================================================================
   THE BUCKET -- PRIVATE, SERVER-MEDIATED, NEVER A BARE PUBLIC URL.
   =====================================================================================
   "adapt the whatsapp tech, when someone uploads their 5mb photo, we optimize it before
    storing and store the low quality" -- the app compresses on the PHONE before it ever
   sends a byte (a field officer's connection is the one paying for the upload), so what
   lands here is already small. This only creates the bucket; every read and write still
   goes through the API with the service-role key, the same as every table in this system --
   `public: false` means a leaked path is not a leaked photo. Safe to re-run. */
insert into storage.buckets (id, name, public)
values ('kyc-photos', 'kyc-photos', false)
on conflict (id) do nothing;
