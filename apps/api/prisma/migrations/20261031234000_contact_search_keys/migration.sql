-- Original contact values are preserved. Normalized keys support duplicate review, never unique-person inference.
ALTER TABLE customers ADD COLUMN normalized_name text NOT NULL DEFAULT '', ADD COLUMN normalized_phone text NOT NULL DEFAULT '', ADD COLUMN normalized_email text NOT NULL DEFAULT '';
CREATE FUNCTION av8_contact_search_keys() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW.normalized_name := trim(regexp_replace(regexp_replace(translate(lower(normalize(NEW.name,NFKC)), 'أإآٱى', 'ااااي'), '[ـً-ٰٟ]', '', 'g'), '\s+', ' ', 'g'));
  NEW.normalized_phone := regexp_replace(regexp_replace(translate(normalize(coalesce(NEW.phone,''),NFKC),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'), '[^0-9]', '', 'g'), '^00', '');
  NEW.normalized_email := lower(trim(coalesce(NEW.email,'')));
  RETURN NEW;
END $$;
CREATE TRIGGER av8_customer_search_keys BEFORE INSERT OR UPDATE OF name,phone,email ON customers FOR EACH ROW EXECUTE FUNCTION av8_contact_search_keys();
UPDATE customers SET name=name;
CREATE INDEX customers_tenant_id_company_id_normalized_phone_idx ON customers(tenant_id,company_id,normalized_phone);
CREATE INDEX customers_tenant_id_company_id_normalized_name_idx ON customers(tenant_id,company_id,normalized_name);
CREATE INDEX customers_tenant_id_company_id_normalized_email_idx ON customers(tenant_id,company_id,normalized_email);
