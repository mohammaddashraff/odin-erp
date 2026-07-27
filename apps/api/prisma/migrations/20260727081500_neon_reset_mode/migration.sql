-- Neon does not grant the superuser-only session_replication_role setting.
-- A transaction-local custom setting lets the administrator reset workflow
-- bypass immutable-row guards without weakening normal application traffic.
CREATE OR REPLACE FUNCTION reset_mode_enabled() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.reset_mode', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF reset_mode_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '55000';
END $$;

CREATE OR REPLACE FUNCTION reject_posted_journal_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF reset_mode_enabled() THEN RETURN NEW; END IF;
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journal entries are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION reject_posted_journal_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF reset_mode_enabled() THEN RETURN OLD; END IF;
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journal entries cannot be deleted' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION reject_posted_journal_line_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_status "JournalStatus";
BEGIN
  IF reset_mode_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO parent_status FROM journal_entries WHERE id = COALESCE(OLD.journal_entry_id, NEW.journal_entry_id);
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'Lines of a posted journal entry are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION reject_posted_document_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF reset_mode_enabled() THEN RETURN NEW; END IF;
  IF OLD.status = 'POSTED' THEN
    IF (to_jsonb(NEW) - 'paid_minor' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'paid_minor' - 'updated_at') THEN
      RAISE EXCEPTION 'Posted documents are immutable; use a return or reversal' USING ERRCODE = '55000';
    END IF;
    IF NEW.paid_minor < 0 OR NEW.paid_minor > NEW.total_minor THEN
      RAISE EXCEPTION 'Allocated amount must remain between zero and the posted document total' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION reject_posted_document_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF reset_mode_enabled() THEN RETURN OLD; END IF;
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted documents cannot be deleted; use a return or reversal' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION reject_posted_document_line_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_status "WorkflowStatus";
BEGIN
  IF reset_mode_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO parent_status FROM documents WHERE id = COALESCE(OLD.document_id, NEW.document_id);
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'Lines of a posted document are immutable; use a return or reversal' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
