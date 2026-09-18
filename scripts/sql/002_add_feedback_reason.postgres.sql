ALTER TABLE message_feedback
  ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE message_feedback
  DROP CONSTRAINT IF EXISTS message_feedback_reason_check;

ALTER TABLE message_feedback
  ADD CONSTRAINT message_feedback_reason_check
  CHECK (reason IS NULL OR reason IN ('slow_response', 'wrong_citation', 'poor_retrieval'));
