BEGIN;

ALTER TABLE message_feedback
  DROP CONSTRAINT IF EXISTS message_feedback_reason_check;

ALTER TABLE message_feedback
  ADD CONSTRAINT message_feedback_reason_check
  CHECK (reason IS NULL OR reason IN (
    'slow_response',
    'wrong_citation',
    'poor_retrieval',
    'not_relevant',
    'missing_incomplete_information',
    'accurate_helpful',
    'clear_easy_to_understand',
    'relevant_complete',
    'other'
  ));

COMMIT;
