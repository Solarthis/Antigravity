-- =============================================================================
-- PROJECT ANTIGRAVITY — Default Hunt Seeds
-- =============================================================================
-- Seeds the primary hunt target: Toyota Tacoma 2012-2015 Access Cab
-- Idempotent: uses ON CONFLICT to avoid duplicates on re-run.

INSERT INTO hunts (name, make, model, year_min, year_max, body_style, keywords, max_bid, is_active)
VALUES (
    'Tacoma Access Cab Hunt',
    'TOYOTA',
    'TACOMA',
    2012,
    2015,
    'ACCESS CAB',
    ARRAY['access', 'ext cab', 'extended', 'extra cab'],
    15000.00,
    true
)
ON CONFLICT DO NOTHING;
