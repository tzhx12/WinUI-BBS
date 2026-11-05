ALTER TABLE posts
  ADD COLUMN copyright_license TEXT NOT NULL DEFAULT 'none'
  CONSTRAINT posts_copyright_license_check CHECK (copyright_license IN (
    'none', 'cc0', 'cc-by-4.0', 'cc-by-sa-4.0', 'cc-by-nc-4.0',
    'cc-by-nc-sa-4.0', 'cc-by-nd-4.0', 'cc-by-nc-nd-4.0', 'all-rights-reserved'
  ));
