-- Merge holders atomically: move cards, collect aliases, delete sources.
CREATE OR REPLACE FUNCTION merge_holders_atomic(
  p_primary_holder_id UUID,
  p_source_holder_ids UUID[]
)
RETURNS TABLE(merged_cards_count INTEGER, updated_aliases TEXT[])
LANGUAGE plpgsql
AS $$
DECLARE
  v_primary card_holders%ROWTYPE;
  v_source_count INTEGER;
BEGIN
  IF p_primary_holder_id IS NULL THEN
    RAISE EXCEPTION 'primary holder id is required';
  END IF;

  IF p_source_holder_ids IS NULL OR array_length(p_source_holder_ids, 1) IS NULL THEN
    merged_cards_count := 0;
    updated_aliases := ARRAY[]::TEXT[];
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_primary_holder_id = ANY(p_source_holder_ids) THEN
    RAISE EXCEPTION 'primary holder cannot be included in source holders';
  END IF;

  SELECT * INTO v_primary
  FROM card_holders
  WHERE id = p_primary_holder_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'primary holder does not exist';
  END IF;

  SELECT COUNT(*) INTO v_source_count
  FROM (
    SELECT 1
    FROM card_holders
    WHERE id = ANY(p_source_holder_ids)
      AND created_by = v_primary.created_by
    FOR UPDATE
  ) locked_sources;

  IF v_source_count <> array_length(p_source_holder_ids, 1) THEN
    RAISE EXCEPTION 'all source holders must exist and belong to same user as primary holder';
  END IF;

  WITH alias_values AS (
    SELECT unnest(COALESCE(v_primary.aliases, ARRAY[]::TEXT[])) AS alias
    UNION
    SELECT name AS alias
    FROM card_holders
    WHERE id = ANY(p_source_holder_ids)
      AND name IS NOT NULL
      AND name <> v_primary.name
    UNION
    SELECT unnest(COALESCE(aliases, ARRAY[]::TEXT[])) AS alias
    FROM card_holders
    WHERE id = ANY(p_source_holder_ids)
  )
  SELECT COALESCE(array_agg(DISTINCT alias ORDER BY alias), ARRAY[]::TEXT[])
  INTO updated_aliases
  FROM alias_values
  WHERE alias IS NOT NULL
    AND btrim(alias) <> ''
    AND alias <> v_primary.name;

  UPDATE credit_cards
  SET holder_id = p_primary_holder_id
  WHERE holder_id = ANY(p_source_holder_ids);

  GET DIAGNOSTICS merged_cards_count = ROW_COUNT;

  UPDATE card_holders
  SET aliases = updated_aliases
  WHERE id = p_primary_holder_id;

  DELETE FROM card_holders
  WHERE id = ANY(p_source_holder_ids);

  RETURN NEXT;
END;
$$;
