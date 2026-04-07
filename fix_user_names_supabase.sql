BEGIN;

UPDATE public."User" AS target
SET
  "name" = source.correct_name,
  "updatedAt" = NOW()
FROM (
  VALUES
    ('cmmvxs2ou0002ti2ga4ii3swa', '堤　慎一郎'),
    ('cmn2tr1ww0004tir08iyrwngl', '相原　雄一'),
    ('cmn2tvu8v000ftir0w343w3x6', '松澤　春栄'),
    ('cmn2twbir000mtir0p2glh7h4', '藤嶋　義隆'),
    ('cmn2tww19000ttir0zxdlvda0', '近森　大翔'),
    ('cmn2txgfh0018tir0vnlbzyj6', '斎藤　忠夫'),
    ('cmn2txtkt001ftir03rntuwks', '林　良太'),
    ('cmn2tyz77001mtir018nz6mwb', '佐藤　幸雄'),
    ('cmn2u0ujk001ttir0xdthcko3', '飛田　史宏'),
    ('cmn2u2gic001ytir0pipldi83', '岡積　　晃'),
    ('cmn2u2vbu0025tir0rpa9vkh3', '向　貞夫'),
    ('cmn2u3wt8002ctir0v1fabze3', '千葉　孝行'),
    ('cmn2u4ayf002jtir0t5s68vl8', '横山　雄大'),
    ('cmn2u4qz5002qtir0tx4jgobm', '小島　建伍'),
    ('cmn2u53lz002xtir0gt9x5z6q', '伊東　和彦'),
    ('cmn2u5ird0034tir0ziwj20aq', '宮川　直也'),
    ('cmn2u5uuw003btir09d83ngof', '小杉　宣正'),
    ('cmn2u67ri003itir03in8x5wx', '島　明洋'),
    ('cmn2u6mun003ptir0az8uohcq', '佐藤　一昭'),
    ('cmn2u76xa003ytir0o6um6f1o', '時政　千恵'),
    ('cmn2u7mb30045tir0sz95ij5v', '日常'),
    ('cmn2u7ujr004ctir05y5ajd16', '日常')
) AS source(id, correct_name)
WHERE target."id" = source.id
  AND target."name" IS DISTINCT FROM source.correct_name;

COMMIT;

SELECT "id", "name"
FROM public."User"
WHERE "id" IN (
  'cmmvxs2ou0002ti2ga4ii3swa',
  'cmn2tr1ww0004tir08iyrwngl',
  'cmn2tvu8v000ftir0w343w3x6',
  'cmn2twbir000mtir0p2glh7h4',
  'cmn2tww19000ttir0zxdlvda0',
  'cmn2txgfh0018tir0vnlbzyj6',
  'cmn2txtkt001ftir03rntuwks',
  'cmn2tyz77001mtir018nz6mwb',
  'cmn2u0ujk001ttir0xdthcko3',
  'cmn2u2gic001ytir0pipldi83',
  'cmn2u2vbu0025tir0rpa9vkh3',
  'cmn2u3wt8002ctir0v1fabze3',
  'cmn2u4ayf002jtir0t5s68vl8',
  'cmn2u4qz5002qtir0tx4jgobm',
  'cmn2u53lz002xtir0gt9x5z6q',
  'cmn2u5ird0034tir0ziwj20aq',
  'cmn2u5uuw003btir09d83ngof',
  'cmn2u67ri003itir03in8x5wx',
  'cmn2u6mun003ptir0az8uohcq',
  'cmn2u76xa003ytir0o6um6f1o',
  'cmn2u7mb30045tir0sz95ij5v',
  'cmn2u7ujr004ctir05y5ajd16'
)
ORDER BY "name";