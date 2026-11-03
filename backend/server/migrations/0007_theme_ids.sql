-- TPL-025: the ready-made themes and font pairs of plans 2 and 3 take the identifiers of the design.
-- 1. A card without a pair of its own keeps its former pair when its new theme's pair differs:
--    only `ocean` (pair `moderne`, renamed `inter`) becomes a theme with another pair (`minuit`, `playfair`).
update cards set theme = theme || '{"font": "inter"}'::jsonb
 where theme->>'preset' = 'ocean' and not (theme ? 'font');
-- 2. Font pairs.
update cards set theme = jsonb_set(theme, '{font}', to_jsonb(case theme->>'font'
        when 'moderne' then 'inter' when 'editorial' then 'playfair' when 'chaleureux' then 'fraunces' end))
 where theme->>'font' in ('moderne', 'editorial', 'chaleureux');
-- 3. Themes.
update cards set theme = jsonb_set(theme, '{preset}', to_jsonb(case theme->>'preset'
        when 'clair' then 'craie' when 'sombre' then 'encre' when 'sable' then 'ivoire'
        when 'ocean' then 'minuit' when 'foret' then 'sauge' when 'corail' then 'terracotta' end))
 where theme->>'preset' in ('clair', 'sombre', 'sable', 'ocean', 'foret', 'corail');
