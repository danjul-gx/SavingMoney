-- =============================================================================
-- Seed: Default app_settings per-user
-- Run after migration. Replace '<your-user-uuid>' with actual auth.users.id.
-- In production, this is inserted at user onboarding via application layer.
-- =============================================================================

-- Example: insert default weekly multiplier for a user
-- INSERT INTO app_settings (user_id, key, value)
-- VALUES ('<your-user-uuid>', 'weekly_multiplier', '4.3')
-- ON CONFLICT (user_id, key) DO NOTHING;

-- The application layer inserts this row automatically during user signup.
-- No static seed data needed — all data is user-scoped.
