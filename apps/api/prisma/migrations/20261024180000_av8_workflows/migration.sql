-- CreateTable
CREATE TABLE "av8_leads" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "owner_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "campaign" TEXT,
    "program" TEXT NOT NULL,
    "phones" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "inquiry_at" TIMESTAMPTZ(3) NOT NULL,
    "first_contact_at" TIMESTAMPTZ(3),
    "next_follow_up" TIMESTAMPTZ(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "av8_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av8_applications" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "owner_id" BIGINT NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "academy_id" BIGINT NOT NULL,
    "reference" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "admissions" TEXT NOT NULL DEFAULT 'FEE_PENDING',
    "medical" TEXT NOT NULL DEFAULT 'PENDING',
    "visa" TEXT NOT NULL DEFAULT 'PREPARING',
    "travel" TEXT NOT NULL DEFAULT 'PREPARING',
    "guardian" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "departed_at" TIMESTAMPTZ(3),

    CONSTRAINT "av8_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av8_records" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "lead_id" BIGINT,
    "application_id" BIGINT,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_by_id" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "av8_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av8_policies" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "approved_by_id" BIGINT,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "av8_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av8_charges" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "application_id" BIGINT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount_minor" BIGINT NOT NULL,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    "due_date" DATE,
    "milestone" TEXT NOT NULL,
    "predeparture" BOOLEAN NOT NULL,
    "deferred" BOOLEAN NOT NULL DEFAULT false,
    "contract_id" BIGINT,

    CONSTRAINT "av8_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av8_funds" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "branch_id" BIGINT NOT NULL,
    "application_id" BIGINT,
    "academy_id" BIGINT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "usd_minor" BIGINT NOT NULL,
    "usd_rate_micros" BIGINT NOT NULL,
    "base_rate_micros" BIGINT NOT NULL,
    "rate_date" DATE NOT NULL,
    "posting_date" DATE NOT NULL,
    "bank_account_id" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "payer" TEXT NOT NULL,
    "evidence_id" TEXT,
    "refund_case_id" BIGINT,
    "created_by_id" BIGINT NOT NULL,
    "approved_by_id" BIGINT,
    "approved_at" TIMESTAMPTZ(3),
    "cleared_at" TIMESTAMPTZ(3),
    "bank_transaction_id" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "av8_funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av8_obligations" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "application_id" BIGINT NOT NULL,
    "key" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "predeparture" BOOLEAN NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "av8_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av8_allocations" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "fund_id" BIGINT NOT NULL,
    "charge_id" BIGINT,
    "obligation_id" BIGINT,
    "amount_minor" BIGINT NOT NULL,
    "reversed_id" BIGINT,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "av8_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av8_attachments" (
    "id" UUID NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "application_id" BIGINT NOT NULL,
    "record_id" BIGINT NOT NULL,
    "category" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "uploaded_by_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "av8_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "av8_leads_tenant_id_branch_id_owner_id_status_idx" ON "av8_leads"("tenant_id", "branch_id", "owner_id", "status");

-- CreateIndex
CREATE INDEX "av8_leads_tenant_id_next_follow_up_idx" ON "av8_leads"("tenant_id", "next_follow_up");

-- CreateIndex
CREATE INDEX "av8_applications_tenant_id_branch_id_owner_id_idx" ON "av8_applications"("tenant_id", "branch_id", "owner_id");

-- CreateIndex
CREATE INDEX "av8_applications_tenant_id_visa_travel_idx" ON "av8_applications"("tenant_id", "visa", "travel");

-- CreateIndex
CREATE UNIQUE INDEX "av8_applications_tenant_id_reference_key" ON "av8_applications"("tenant_id", "reference");

-- CreateIndex
CREATE INDEX "av8_records_tenant_id_kind_status_idx" ON "av8_records"("tenant_id", "kind", "status");

-- CreateIndex
CREATE INDEX "av8_records_tenant_id_lead_id_kind_idx" ON "av8_records"("tenant_id", "lead_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "av8_records_application_id_kind_key_key" ON "av8_records"("application_id", "kind", "key");

-- CreateIndex
CREATE INDEX "av8_policies_tenant_id_kind_status_idx" ON "av8_policies"("tenant_id", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "av8_policies_tenant_id_kind_key_version_key" ON "av8_policies"("tenant_id", "kind", "key", "version");

-- CreateIndex
CREATE INDEX "av8_charges_tenant_id_due_date_idx" ON "av8_charges"("tenant_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "av8_charges_application_id_key_key" ON "av8_charges"("application_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "av8_funds_refund_case_id_key" ON "av8_funds"("refund_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "av8_funds_bank_transaction_id_key" ON "av8_funds"("bank_transaction_id");

-- CreateIndex
CREATE INDEX "av8_funds_tenant_id_branch_id_kind_status_idx" ON "av8_funds"("tenant_id", "branch_id", "kind", "status");

-- CreateIndex
CREATE INDEX "av8_obligations_tenant_id_application_id_idx" ON "av8_obligations"("tenant_id", "application_id");

-- CreateIndex
CREATE UNIQUE INDEX "av8_obligations_application_id_key_key" ON "av8_obligations"("application_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "av8_allocations_reversed_id_key" ON "av8_allocations"("reversed_id");

-- CreateIndex
CREATE INDEX "av8_allocations_tenant_id_fund_id_idx" ON "av8_allocations"("tenant_id", "fund_id");

-- CreateIndex
CREATE INDEX "av8_attachments_tenant_id_application_id_record_id_idx" ON "av8_attachments"("tenant_id", "application_id", "record_id");

-- AddForeignKey
ALTER TABLE "av8_leads" ADD CONSTRAINT "av8_leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_applications" ADD CONSTRAINT "av8_applications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_applications" ADD CONSTRAINT "av8_applications_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_applications" ADD CONSTRAINT "av8_applications_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "av8_leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_records" ADD CONSTRAINT "av8_records_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "av8_leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_records" ADD CONSTRAINT "av8_records_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "av8_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_charges" ADD CONSTRAINT "av8_charges_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "av8_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_funds" ADD CONSTRAINT "av8_funds_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "av8_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_funds" ADD CONSTRAINT "av8_funds_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_obligations" ADD CONSTRAINT "av8_obligations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "av8_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_allocations" ADD CONSTRAINT "av8_allocations_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "av8_funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_allocations" ADD CONSTRAINT "av8_allocations_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "av8_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_allocations" ADD CONSTRAINT "av8_allocations_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "av8_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_attachments" ADD CONSTRAINT "av8_attachments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "av8_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av8_attachments" ADD CONSTRAINT "av8_attachments_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "av8_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Legacy migrations refer to odin_app. It is a non-login policy group inside
-- each new AV8 cluster, never a credential for an Odin database.
ALTER ROLE odin_app NOLOGIN PASSWORD NULL;
GRANT odin_app TO av8_runtime;
GRANT USAGE ON SCHEMA public TO av8_runtime;
ALTER TABLE av8_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON av8_leads FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON av8_leads TO odin_app;
ALTER TABLE av8_leads ADD CONSTRAINT av8_leads_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE av8_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON av8_applications FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON av8_applications TO odin_app;
ALTER TABLE av8_applications ADD CONSTRAINT av8_applications_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE av8_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON av8_records FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON av8_records TO odin_app;
ALTER TABLE av8_records ADD CONSTRAINT av8_records_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE av8_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON av8_policies FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON av8_policies TO odin_app;
ALTER TABLE av8_policies ADD CONSTRAINT av8_policies_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE av8_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON av8_charges FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON av8_charges TO odin_app;
ALTER TABLE av8_charges ADD CONSTRAINT av8_charges_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE av8_funds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON av8_funds FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON av8_funds TO odin_app;
ALTER TABLE av8_funds ADD CONSTRAINT av8_funds_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE av8_obligations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON av8_obligations FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON av8_obligations TO odin_app;
ALTER TABLE av8_obligations ADD CONSTRAINT av8_obligations_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE av8_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON av8_allocations FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON av8_allocations TO odin_app;
ALTER TABLE av8_allocations ADD CONSTRAINT av8_allocations_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE av8_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON av8_attachments FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON av8_attachments TO odin_app;
ALTER TABLE av8_attachments ADD CONSTRAINT av8_attachments_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO odin_app;
ALTER TABLE av8_leads ADD CONSTRAINT av8_leads_branch_id_fk FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE av8_leads ADD CONSTRAINT av8_leads_owner_id_fk FOREIGN KEY (owner_id) REFERENCES users(id);
ALTER TABLE av8_applications ADD CONSTRAINT av8_applications_branch_id_fk FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE av8_applications ADD CONSTRAINT av8_applications_owner_id_fk FOREIGN KEY (owner_id) REFERENCES users(id);
ALTER TABLE av8_records ADD CONSTRAINT av8_records_created_by_id_fk FOREIGN KEY (created_by_id) REFERENCES users(id);
ALTER TABLE av8_policies ADD CONSTRAINT av8_policies_approved_by_id_fk FOREIGN KEY (approved_by_id) REFERENCES users(id);
ALTER TABLE av8_charges ADD CONSTRAINT av8_charges_contract_id_fk FOREIGN KEY (contract_id) REFERENCES av8_records(id);
ALTER TABLE av8_funds ADD CONSTRAINT av8_funds_branch_id_fk FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE av8_funds ADD CONSTRAINT av8_funds_academy_id_fk FOREIGN KEY (academy_id) REFERENCES suppliers(id);
ALTER TABLE av8_funds ADD CONSTRAINT av8_funds_bank_account_id_fk FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
ALTER TABLE av8_funds ADD CONSTRAINT av8_funds_created_by_id_fk FOREIGN KEY (created_by_id) REFERENCES users(id);
ALTER TABLE av8_funds ADD CONSTRAINT av8_funds_approved_by_id_fk FOREIGN KEY (approved_by_id) REFERENCES users(id);
ALTER TABLE av8_funds ADD CONSTRAINT av8_funds_refund_case_id_fk FOREIGN KEY (refund_case_id) REFERENCES av8_records(id);
ALTER TABLE av8_attachments ADD CONSTRAINT av8_attachments_uploaded_by_id_fk FOREIGN KEY (uploaded_by_id) REFERENCES users(id);

ALTER TABLE av8_charges ADD CHECK (amount_minor > 0 AND credit_minor >= 0 AND credit_minor <= amount_minor);
ALTER TABLE av8_obligations ADD CHECK (amount_minor > 0);
ALTER TABLE av8_allocations ADD CHECK ((charge_id IS NOT NULL) <> (obligation_id IS NOT NULL));
ALTER TABLE av8_allocations ADD CHECK (amount_minor <> 0);
ALTER TABLE av8_funds ADD CHECK (amount_minor > 0 AND usd_minor > 0 AND usd_rate_micros > 0 AND base_rate_micros > 0);
ALTER TABLE av8_allocations ADD FOREIGN KEY (reversed_id) REFERENCES av8_allocations(id);
CREATE FUNCTION av8_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'AV8 evidence and posted history are immutable; use an audited correction';
END $$;
CREATE TRIGGER av8_allocation_immutable BEFORE UPDATE OR DELETE ON av8_allocations FOR EACH ROW EXECUTE FUNCTION av8_immutable();
CREATE TRIGGER av8_attachment_immutable BEFORE UPDATE OR DELETE ON av8_attachments FOR EACH ROW EXECUTE FUNCTION av8_immutable();
CREATE TRIGGER av8_obligation_immutable BEFORE UPDATE OR DELETE ON av8_obligations FOR EACH ROW EXECUTE FUNCTION av8_immutable();
CREATE FUNCTION av8_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP = 'DELETE' OR (OLD.status IN ('SIGNED','CLEARED') OR (TG_TABLE_NAME = 'av8_policies' AND OLD.status = 'APPROVED')) THEN
  RAISE EXCEPTION 'Approved AV8 terms and cleared funds are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_policy_snapshot BEFORE UPDATE OR DELETE ON av8_policies FOR EACH ROW EXECUTE FUNCTION av8_snapshot_guard();
CREATE TRIGGER av8_contract_snapshot BEFORE UPDATE OR DELETE ON av8_records FOR EACH ROW WHEN (OLD.kind = 'contract') EXECUTE FUNCTION av8_snapshot_guard();
CREATE TRIGGER av8_cleared_fund BEFORE UPDATE OR DELETE ON av8_funds FOR EACH ROW EXECUTE FUNCTION av8_snapshot_guard();
