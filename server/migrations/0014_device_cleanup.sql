-- One phone, one row: every reinstall of the Android app paired again and added a "Phone (Android)". Keep the one
-- seen most recently and revoke the rest (revoked, not deleted). Pairing now reuses the row (auth.js pairDevice).
UPDATE devices SET revoked = 1
WHERE revoked = 0 AND platform = 'android' AND EXISTS (
  SELECT 1 FROM devices d
  WHERE d.revoked = 0 AND d.platform = devices.platform AND d.name = devices.name AND d.scope = devices.scope
    AND (COALESCE(d.last_seen_at, d.created_at) > COALESCE(devices.last_seen_at, devices.created_at)
      OR (COALESCE(d.last_seen_at, d.created_at) = COALESCE(devices.last_seen_at, devices.created_at) AND d.id > devices.id)));

-- The "My builds" token from the README lives in Kevin's laptop build.
UPDATE devices SET name = 'Laptop', platform = 'laptop' WHERE platform = 'build';
