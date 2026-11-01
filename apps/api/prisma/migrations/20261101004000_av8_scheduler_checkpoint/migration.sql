CREATE UNIQUE INDEX av8_scheduler_checkpoint_identity ON av8_records(tenant_id,key) WHERE kind='scheduler-checkpoint';
