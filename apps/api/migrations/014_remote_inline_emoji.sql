-- Keep existing remote emoji blocks identifiable without rewriting their text or layout data.
DO $$
DECLARE target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['posts','replies'] LOOP
    EXECUTE format($sql$
      UPDATE %I SET body=jsonb_set(body,'{blocks}',(
        SELECT jsonb_agg(CASE WHEN m.id IS NOT NULL THEN
          jsonb_set(b.block,'{data}',(b.block->'data') || jsonb_build_object('remote',TRUE,'emojiId',m.id))
          ELSE b.block END ORDER BY b.position)
        FROM jsonb_array_elements(body->'blocks') WITH ORDINALITY AS b(block,position)
        LEFT JOIN media_assets m ON b.block->>'type'='emoji' AND m.remote_cached
          AND '/uploads/' || m.storage_key=b.block#>>'{data,url}'
      )) WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(body->'blocks') AS b(block)
        JOIN media_assets m ON m.remote_cached AND '/uploads/' || m.storage_key=b.block#>>'{data,url}'
        WHERE b.block->>'type'='emoji'
      )
    $sql$,target_table);
  END LOOP;
END $$;
