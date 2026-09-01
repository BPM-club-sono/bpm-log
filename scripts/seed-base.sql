-- Données de base du parc, injectées à la création d'un stack worktree
-- (scripts/worktree-stack.sh up) après « alembic upgrade head ».
--
-- Idempotent : rejouable sur une DB déjà peuplée (clone de la DB de dev)
-- sans créer de doublon. `categories.nom` n'a pas de contrainte d'unicité,
-- d'où le WHERE NOT EXISTS plutôt qu'un ON CONFLICT.

BEGIN;

-- Catégories de matériel
INSERT INTO categories (nom, description)
SELECT v.nom, v.description
FROM (VALUES
    ('Son',       'Enceintes, amplis, tables de mixage, micros'),
    ('Light',     'Projecteurs, lyres, PAR LED, pupitres'),
    ('Structure', 'Pieds, ponts, élingues, lests'),
    ('Mapping',   'Vidéoprojecteurs, médiaserveurs, écrans LED')
) AS v(nom, description)
WHERE NOT EXISTS (
    SELECT 1 FROM categories c WHERE c.nom = v.nom
);

-- Fournisseurs de location. `code` est le trigramme qui préfixe les références
-- du matériel loué chez eux. Le garde-fou porte sur le nom ET le code : une DB
-- clonée peut déjà contenir un « Novelty » saisi à la main, sans trigramme.
INSERT INTO fournisseurs (nom, code, favori)
SELECT v.nom, v.code, true
FROM (VALUES
    ('Impact',  'IMP'),
    ('Novelty', 'NOV')
) AS v(nom, code)
WHERE NOT EXISTS (
    SELECT 1 FROM fournisseurs f WHERE f.nom = v.nom OR f.code = v.code
);

-- Rattrapage : un fournisseur homonyme déjà présent (DB clonée) mais sans
-- trigramme prendrait EXT sur ses références. On le complète, sauf si le code
-- est déjà pris par un autre fournisseur.
UPDATE fournisseurs f
SET code = v.code
FROM (VALUES ('Impact', 'IMP'), ('Novelty', 'NOV')) AS v(nom, code)
WHERE f.nom = v.nom
  AND f.code IS NULL
  AND NOT EXISTS (SELECT 1 FROM fournisseurs o WHERE o.code = v.code);

COMMIT;
