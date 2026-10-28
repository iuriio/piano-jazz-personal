# Me acompanhar: plano

Status: proposta, nada implementado. Branch de referência: `feat/orb-layout`.

## 1. A ideia, nas suas palavras

Você senta e toca, no free play: acordes, uma escala, um improviso, um Hanon. Enquanto isso o
app escuta em segundo plano. Depois de alguns segundos aparece, discreto, ao lado da marca
no canto superior esquerdo, um convite: **accompany?** Se você aceita, o app já sabe em que
tom você está, mais ou menos em que andamento e com que densidade toca, e começa um
acompanhamento baixinho, bem no fundo: piano e baixo, acordes simples (um I–IV, um ii–V–I
em B♭ se você estava tocando a escala de B♭). Enquanto você sola, ele **gera a progressão e
mostra os próximos compassos antes de tocá-los**, como uma folha do iReal Pro: uma grade
de compassos com cifras, 4 por linha, o compasso atual aceso e as próximas 4 já visíveis.
Você pode deixar os acordes mais simples ou mais ricos e ver a mudança nos compassos que
vêm. Se você acelera ou desacelera, ele acompanha (ou trava, se você preferir).

O que muda em relação ao **Harmonise** (OrbKord, e a linha `Harmonise` do nosso roadmap):

| | Harmonise (por nota) | Me acompanhar |
| --- | --- | --- |
| Quem lidera | você; cada nota ganha um acorde embaixo | o app propõe uma progressão no tempo e você toca sobre ela |
| Tempo | nenhum, reage a cada nota | tem pulso, compasso, adianta o próximo acorde |
| Quando liga | você liga | ele escuta e oferece |
| Tela | o acorde da nota atual | a folha: acorde atual + próximos compassos |
| Para quê | ouvir harmonias sob uma melodia | praticar improviso, escala ou Hanon com uma banda mínima |

O Harmonise é reativo e o acompanhamento é preditivo, porque precisa decidir o acorde
**antes** de você chegar nele. Os dois podem dividir o planejador de acordes (seção 4.3).

## 2. Pesquisa (curta, para justificar as escolhas)

### 2.1 Tonalidade a partir de um fluxo MIDI

- **Krumhansl–Schmuckler**: soma a duração de cada classe de altura numa janela e correlaciona
  com um perfil para cada uma das 24 tonalidades; fica a de maior correlação.
  [Temperley, *What's key for key?* (1999)](https://music.informatics.indiana.edu/courses/I546/pdf/temperley.pdf)
- **Temperley / Kostka–Payne**: perfis tirados de corpus em vez de experimentos de escuta,
  com segmentos curtos e penalidade por modular, que é exatamente o "não troque de tom a cada
  nota" de que precisamos. Valores em
  [partitura, key_identification](https://partitura.readthedocs.io/en/latest/_modules/partitura/musicanalysis/key_identification.html).
- Em tempo real, os métodos K-S ficam abaixo de 50% de acerto nos primeiros 3 s e chegam a
  80–87% em ~15 s ([Chuan & Chew, ICME 2005](https://www.cecs.uci.edu/~papers/icme05/defevent/papers/cr1029.pdf)).
  Isso valida esperar ~8 s antes de oferecer.

**Experimento feito agora (node + perfis reais):**

| Entrada | K-S (1º vs 2º) | Kostka–Payne (1º vs 2º) |
| --- | --- | --- |
| escala de B♭, notas iguais | B♭ .756 vs Gm .712 | B♭ **.900** vs Gm .754 |
| Hanon nº 1 em C | C .788 vs Am **.781** (empate) | C **.889** vs Am .763 |
| lick em Sol menor | Gm .849 vs G .676 | idem |
| D dórico com D pesando | Dm .793 vs D .769 | idem |

Conclusão: **usar Kostka–Payne**, que separa bem a relativa menor onde o K-S empata (justamente
no Hanon). Para modos, correlação de 24 tonalidades não basta: D dórico sai "D menor" ou "C".
Por isso o estimador é em **duas etapas**: (1) qual coleção de 7 notas (= armadura); (2) qual
centro dentro dela, por peso de baixo, nota final de frase e duração (seção 4.1).

### 2.2 Pulso a partir de onsets

- [Dixon 2001](https://courses.cs.washington.edu/courses/cse590m/08wi/Dixon%20-%20Automatic%20Extraction%20of%20Tempo%20and%20Beat%20from%20Expressive%20Performances.pdf):
  agrupa intervalos entre ataques (IOI) em hipóteses de tempo em vários níveis métricos e
  segue múltiplas hipóteses. O erro mais comum é dobrar ou dividir o tempo por 2. Vamos ter
  esse erro, e a UI precisa permitir corrigir com um clique.
- Para seguir o tempo ao vivo: osciladores adaptativos que corrigem fase e período a cada
  ataque dentro de uma janela em torno do beat previsto ([Large & Kolen, via Sethares & Arora 2007](https://sethares.engr.wisc.edu/paperspdf/ICASSP2007.pdf);
  [Pardo 2004, rastreador online com um oscilador](https://archives.ismir.net/ismir2004/paper/000206.pdf)).
  É simples o bastante para rodar a cada nota no browser.

**Experimento feito agora** (tatum = menor IOI regular, ajuste em grade; beat = tatum × k com
prior log-normal em ~100 bpm + bônus de acento por velocity):

| Entrada sintética (jitter ±12 ms) | Resultado | Resíduo da grade |
| --- | --- | --- |
| semicolcheias a 92, com acento | **91** (alt. 122, 183) | .063 |
| semicolcheias a 92, sem acento | **92** | .055 |
| colcheias a 120 | **119** | .044 |
| tercinas a 80 | **80** | .030 |
| semínimas a 72 | **72** | .011 |
| ritmo misto a 100 | **100** | .026 |
| rubato (IOI aleatório 200–900 ms) | 81 (sem sentido) | **.293** |

Uma tentativa ingênua (todos os pares de IOI contra uma grade) deu 123 para semicolcheias
a 92 (agrupa de 3 em 3). Achar o tatum primeiro resolveu. O resíduo separa bem tocar a tempo
(< .07) de rubato (~.3): **limiar 0,12**. Abaixo disso há grade; acima, o acompanhamento entra
em modo *pad* e muda de acorde por frase, sem grade.

### 2.3 Escolha de progressão

- Acordes por função (T / SD / D) já vêm no `tonal`: `Key.majorKey('Bb').chordsHarmonicFunction`
  devolve `T SD T SD D T D`, e `Progression.fromRomanNumerals('Bb', ['IIm7','V7','Imaj7'])`
  devolve `Cm7 F7 Bbmaj7` (testado).
- [MySong (Simon, Morris, Basu, CHI 2008)](https://microsoft.com/en-us/research/uploads/prod/2016/02/mysongchi2008.pdf):
  HMM em que cada compasso escolhe um acorde pela compatibilidade com as notas do compasso e
  pela transição entre acordes. Para melodia **conhecida** (o exercício do shred) é exatamente
  isso, com Viterbi; a matriz de transição pode ser feita à mão, sem treino.
- [Cabral, Briot, Pachet 2006](https://www.francoispachet.fr/wp-content/uploads/2021/01/cabral-06a.pdf)
  e o [Continuator](https://www.francoispachet.fr/?p=4360): acompanhamento que aprende o estilo
  do músico. É pesado demais para nós; serve só como referência de que reagir ao estilo é desejável.

### 2.4 Como os produtos fazem

- **Teclados arranjadores (Yamaha/Casio)**: você **dita** o acorde com a mão esquerda numa zona
  (single finger, fingered) e o estilo toca. O
  [*flicker* de acordes errados enquanto as notas chegam](https://forum.psrtutorial.com/index.php?msg=521348)
  é o mesmo problema que o nosso `settle` resolve. Os modos "Smart Chord" deduzem maior/menor
  pela escala escolhida, ou seja, você ainda informa a tonalidade.
- **Band-in-a-Box / Logic Session Players**: você escreve a progressão e a banda segue
  ([Logic: player segue a Chord track; sem acorde, toca a tônica](https://support.apple.com/en-lamr/guide/logicpro/lgcp70dd5af3/mac);
  [BiaB RealTracks](https://www.pgmusic.com/manuals/bbw2026full/chapter7.htm)).
- **Score following** (Dannenberg 1984, [Raphael, Music Plus One](https://music.informatics.indiana.edu/~craphael/music_plus_one/globe.html);
  [ACCompanion 2023](https://arxiv.org/pdf/2304.12939)): seguir uma partitura conhecida exige
  **prever** o próximo ataque, porque só reagir chega atrasado. A mesma lição vale para nós.
- **iReal Pro**: a referência principal de **dinâmica**, não de código. Pelo que é público
  ([estilos](https://www.irealpro.com/learn/accompaniment-styles),
  [review Macworld](https://www.macworld.com/article/223657/ireal-pro-for-mac-review-a-harmonious-practice-tool-for-musicians.html)):
  piano + baixo + bateria por estilo; **conjuntos de padrões diferentes** no primeiro e no
  último chorus e entre seções; o swing escolhe padrões **por faixa de andamento** (< 100,
  100–139, 140–219, 220+); a bateria faz virada só em barra dupla/repetição; há mixer por
  instrumento. O review elogia o jazz e acha o pop genérico, e a gente deve pegar o lado jazz.

Nenhum desses **escuta e oferece**. O arranjador precisa que você dite o acorde, o iReal e o
BiaB precisam da cifra escrita, e o score following precisa da partitura. Aqui o app gera a
cifra a partir do que você está tocando e a mostra adiante. Pelo que encontrei, isso é novo de fato.

### 2.5 O que faz um comping gerado soar vivo

1. **Condução de vozes**: notas comuns ficam, o resto anda por grau; 3ª e 7ª (guide tones) são
   o esqueleto ([comping guide](https://pianowithjonny.com/piano-lessons/jazz-piano-comping-guide-beginner-to-pro/)).
   Já temos shells e rootless em `src/voicings.ts`.
2. **Vocabulário rítmico, não aleatório**: Charleston (1 e "e" do 2), Charleston invertido
   ("e" do 1 e 3), antecipação do próximo acorde no "e" do 4, nota longa nas baladas, e
   **espaço**: um ou dois ataques por compasso bastam atrás de um solista, sem repetir o mesmo
   ritmo todo compasso.
3. **Baixo andando por slots**: tempo 1 = fundamental, 2 = nota do acorde, 3 = passagem,
   4 = aproximação cromática (meio tom acima/abaixo) da próxima fundamental
   ([Talking Bass](https://www.talkingbass.net/walking-bass-lines-made-easy/),
   [Yamaha Hub](https://hub.yamaha.com/keyboards/k-how-to/what-to-do-when-theres-no-bass-player-part-2/)).
4. **Humanização com estrutura**: um bom músico tem microtiming consistente, não aleatório
   ([discussão Ardour](https://discourse.ardour.org/t/how-do-i-humanize-a-midi-track/100123)).
   Então: acento fixo por posição (2 e 4 no swing), piano levemente atrás do beat, baixo em
   cima dele, e só um pouco de ruído (velocity ±6, tempo ±6 ms).
5. **Variação por seção**: mesma progressão, padrão diferente a cada frase de 4 compassos,
   como o iReal faz entre choruses.

## 3. O que já existe no código e é reaproveitado

| Peça | Onde | Uso aqui |
| --- | --- | --- |
| Fluxo bruto com velocity e tempo | `src/midi.ts`: `subscribeRaw`, `subscribeMidi`, `parseNoteEvent` | o ouvinte assina uma vez, como `liveNotes` |
| Estado das teclas + pedal | `applyMidiMessage`, `newKeys` | duração real das notas (pedal incluso) para pesar a tonalidade |
| Store fora do React | `src/stage/liveNotes.ts` (`onLiveChange`, versão) | mesmo padrão para o estado do acompanhamento (`useSyncExternalStore`) |
| Configurações persistidas | `src/stage/settings.ts` (`StageSettings`, `loadStage` valida) | novo campo `accompany` validado no load |
| Topbar com a marca | `src/App.tsx`, `<h1>keytrainer<span class="caret"/></h1>` | o widget entra logo depois do `h1` |
| Slots do palco | `src/stage/Workspace.tsx` (`aside`, `banner`, `roll`) | a folha de compassos ocupa o slot `aside` (seção 5) |
| Tonalidades e grafia | `src/analysis.ts`: `KEY_SIGNATURES`, `keyById`, `spellPc`, `readChord` | cifras grafadas no tom; `readChord` lê os acordes que **você** toca |
| Nomes jazz | `src/stage/naming.ts`: `styleSymbol`, `jazzQuality` | a folha usa o mesmo estilo de nome do card (Δ – ø) |
| Voicings | `src/voicings.ts` (`VOICINGS`, `voicingToMidi`) + `tonal` `Voicing.sequence` | shells/rootless com condução de vozes |
| Áudio | `src/audio.ts` (um `AudioContext`, `getMasterBus`), `schedulePianoTone` em `src/instrument.ts` | piano agendado com hora exata; falta um timbre de pad e um de baixo |
| Agendador com lookahead | `src/shred/clock.ts` `Transport` (25 ms / 100 ms, ponte `audioToPerf`) | mesmo padrão; precisa de modo sem clique, `nudge` de fase e `perfToAudio` |
| Exercícios | `src/shred/pattern.ts` `expandPattern` → notas esperadas e tempos | no shred, a melodia futura é **conhecida**, e dá para harmonizar com Viterbi |

**Regra que não pode ser quebrada:** o acompanhamento **nunca** passa por `injectRaw` nem por
`subscribeRaw`. Se passasse, o ouvinte escutaria a si mesmo, o card leria os acordes do app como
seus e o shred avaliaria as notas do app como erros seus. Ele agenda direto no áudio, num bus
próprio.

## 4. Design

### 4.1 Módulos (novos, em `src/accompany/`)

```
listener.ts       puro + singleton fino: buffer de 30 s, estimativas
  keyEstimate.ts  puro: (notas pesadas) -> { collection, center, mode, confidence, alts }
  pulseEstimate.ts puro: (onsets) -> { bpm, tatumMs, steadiness, swing, phase, alts } | null
progression.ts    puro, com seed: estimativa -> frases de 4 compassos (cifras)
voicing.ts        puro: cifra + voicing anterior + janela de registro -> notas MIDI
patterns.ts       puro: estilo + andamento + frase -> eventos {beat, notes, dur, vel}
follow.ts         puro: rastreador de fase/período (oscilador adaptativo)
machine.ts        puro: redutor da máquina de estados
accompanist.ts    impuro: agendador, bus de áudio, liga tudo, store externo
AccompanyBadge.tsx  widget da topbar
LeadSheet.tsx       folha de compassos (slot aside)
```

**keyEstimate.** Peso de cada nota = duração soando (0,1–2 s, pedal incluso) × (0,5 + vel/254)
× 1,5 se era a nota mais grave no ataque × decaimento `exp(-idade/8s)`. Etapa 1: correlação
Kostka–Payne nas 24 tonalidades, agrupando relativas → **coleção** (= uma das 15 armaduras de
`KEY_SIGNATURES`). Etapa 2: **centro** = classe da coleção com maior soma de (peso de baixo +
2 × nota final de frase + duração); dá maior, menor ou modo (dórico, mixolídio...). Confiança
= margem entre a melhor coleção e a segunda que não seja relativa; oferecer só com
correlação ≥ 0,80 e margem ≥ 0,10, estável por 3 s. Modulação: a nova coleção precisa vencer
por ≥ 0,05 durante 2 compassos (ou 4 s em rubato).

**pulseEstimate.** Funde ataques a < 50 ms (acorde = 1 ataque) → IOIs → tatum por ajuste de grade
em torno do percentil 25 → resíduo RMS (= *steadiness*) → beat = tatum × k (k = 1..4), prior
log-normal em 100 bpm (σ = 0,6 oitava) × (1 + bônus de acento) → fase pelos ataques na grade.
**Swing**: razão média dos pares de colcheias (≥ 0,6 = swing). Devolve alternativas ½× e 2×
para a UI.

**follow (tempo dinâmico).** Durante o acompanhamento, cada ataque a até ±20% de um tatum
previsto gera um erro `e`. Loop rápido: fase += 0,15·e (só para alinhar). Loop lento: período
ajustado pela **mediana** dos erros dos últimos ~8 ataques, quando o sinal se mantém, com
passo de no máximo 2% por compasso. É lento de propósito: você ouve o app e se ajusta a ele,
e se o app seguisse cada nota, os dois arrastariam um ao outro. Se você muda de andamento de
verdade (> 10% por 2 compassos), ele reestima e salta para o novo tempo no próximo compasso.
Opção **lock** = período fixo, só a fase acompanha.

### 4.2 Máquina de estados

```
idle ──notas──▶ listening ──limiares──▶ offer ──aceita──▶ starting ──1º beat──▶ playing
  ▲                 ▲  ◀──15 s / ×─────────┘                               │  ▲
  │                 │                                         silêncio 1,5 │  │ você volta
  │                 │                                         compasso     ▼  │
  │                 └──────────── stop / silêncio 20 s ◀────────────── waiting
  └── modo voicings (sem oferta)            playing ──tom novo──▶ modulating ──▶ playing
```

- **Quando a oferta aparece** (free play): ≥ 8 s de toque ativo nos últimos 15 s (buracos
  < 2 s), ≥ 20 ataques, tonalidade confiável (acima). O pulso **não** é exigido: sem pulso a
  oferta diz "free time" e entra em pad. Some sozinha após 15 s. O × adia por 5 min ou até o
  tom mudar. No máximo uma oferta por tonalidade por sessão, para não incomodar.
- **Início**: o clique é gesto do usuário (`resumeAudio` ok). Começa no próximo beat previsto
  com a **tônica** no compasso 1, o acorde seguro mesmo se o "1" do app não for o seu.
- **Você para**: após 1,5 compasso de silêncio, o acorde atual soa até o fim e o app espera
  (`waiting`), mantendo a posição na folha. Volta quando você volta: se os 3 primeiros ataques
  caem a ±10% do tempo antigo, retoma no próximo beat; senão reestima. Depois de 20 s calado,
  para e volta a `listening`.
- **Você muda de tom**: `modulating`. No limite da próxima frase entra um ii–V do novo tom
  (ou troca direta, se for a relativa ou tom vizinho). A folha mostra `→ E♭` no compasso de
  transição. Opção "seguir mudanças de tom" ligada por padrão.
- **Você toca acordes**: medimos a *chordiness*, a fração de ataques com ≥ 3 notas na mão
  esquerda nos últimos 2 compassos. Acima de 0,5, **quem toca acordes lidera**: o piano do app
  se cala, o baixo continua tocando a fundamental de `readChord` do seu acorde, e a folha
  passa a **registrar** os seus acordes em vez de propor. Quando você volta a solar
  (2 compassos sem acordes), ele retoma propondo a partir do último acorde seu.
- **Voicings drill**: sem oferta na v1, porque o exercício já é tocar os acordes.

### 4.3 Planejador de progressão (o coração do "gera e mostra adiante")

Unidade = **frase de 4 compassos**. O app sempre tem a frase atual (travada) e a próxima
(planejada) na tela. Na batida 1 do último compasso da frase atual, a próxima trava e uma nova
é gerada. A forma é um mini-tema que se repete com variações: **A A′ B A″** (16 compassos), e
cada frase toca com um conjunto de padrões rítmicos diferente, como os choruses do iReal.

Templates por modo (graus romanos → `Progression.fromRomanNumerals`):

| Modo | A (tônica) | B (contraste) | Cadência / volta |
| --- | --- | --- | --- |
| maior | I–vi–ii–V · I–IV–I–V · I–V–vi–IV | IV–iv–I–I · ii–V/ii (relativos) | ii–V–I–I · iii–vi–ii–V |
| menor | i–iv–i–V · i–VI–III–VII | iv–VII–III–VI | iiø–V–i–i |
| dórico | i7–IV7 (vamp) | ♭VII–IV | i7–i7 |
| mixolídio | I7–♭VII | IV–I | I7–I7 |
| rubato | um acorde por frase do usuário, sem grade | | |

**Densidade harmônica**: 1 acorde por compasso, ou 1 a cada 2 compassos se você toca pouco
(< 1,5 nota/s) ou o andamento passa de 160.

**Complexidade** (controle 1–4, muda ao vivo nos compassos não travados):

1. tríades: `B♭ · E♭ · F`
2. tétrades: `B♭Δ · C–7 · F7`
3. extensões e rootless: `B♭Δ9 · C–9 · F13`
4. substituições: dominantes secundárias (`G7♭9 → C–7`), ii–V relativos, subV (`B7 → B♭Δ`),
   backdoor (`A♭7 → B♭Δ`).

A mudança aparece na hora na frase planejada. A frase atual só muda a partir do **próximo**
compasso, porque você pode já estar mirando o acorde que vem.

**Pontuação ao vivo.** Antes de travar cada compasso, o planejador compara o compasso que você
acabou de tocar com o acorde planejado: nota do acorde = +1, tensão disponível = +0,3, nota a
evitar (4ª sobre IΔ, ♭9 sobre m7) = −0,7. Se o acorde fica bem abaixo da melhor alternativa
**da mesma função** (T: I/vi/iii, SD: IV/ii, D: V/vii°), troca por ela. A função se mantém e
a forma não quebra, mas o acorde passa a concordar com o que você está enfatizando.
Determinístico com `seed` (testável).

**Shred (melodia conhecida).** `expandPattern` dá as notas e os tempos de cada compasso
antes de você tocá-los. Viterbi por compasso: emissão = pontuação acima contra as notas
esperadas; transição feita à mão (permanecer < I→IV/ii < V→I barato; saltos sem função
caros). Quando a ordem de tons troca de tom a cada repetição (`order: fourths`), o último
compasso da repetição vira o **V7 do próximo tom**, então o acompanhamento anuncia a
transposição antes de ela acontecer.

### 4.4 Voicing e registro

- **Janela de registro**: a cada compasso, mede-se o percentil 10 e o 90 das notas que você
  tocou nos últimos 8 s. O piano do app usa a maior faixa livre entre E2 e C5 (≥ 1 oitava),
  com a nota de cima ≤ sua nota mais grave − 3 semitons. Se você ocupa tudo (duas mãos
  espalhadas), o piano cai para shell (3–7) bem baixinho e o baixo desce uma oitava.
- **Baixo**: E1–C3; nunca acima da sua nota mais grave − 5.
- **Condução**: o candidato que minimiza o movimento total em semitons em relação ao voicing
  anterior (shells de `VOICINGS` na complexidade 2, rootless via `tonal` `Voicing.sequence`
  na 3+).
- **Choque**: no momento de agendar (lookahead 100 ms), qualquer nota do voicing a 1 ou 13
  semitons de uma nota sua que esteja soando, e que não seja nota do acorde, sai do voicing.

### 4.5 Estilos, padrões e humanização

| Estilo | Piano | Baixo | Quando é o padrão |
| --- | --- | --- | --- |
| `pad` | acorde longo, ataque 250 ms, novo timbre de pad | fundamental longa | rubato ou < 70 bpm |
| `comp` (swing) | Charleston / Charleston invertido / antecipação no "e" do 4 / pausa | 2-feel (1 e 3) | swing detectado |
| `walk` | igual ao comp, mais esparso | walking por slots (1 fund., 2 nota do acorde, 3 passagem, 4 aproximação cromática) | escolha manual; frase B no comp |
| `even` (pop) | colcheias retas leves, antecipações | fund.–5ª | colcheias/semicolcheias retas (Hanon) |

- O padrão é escolhido **por frase**, de um conjunto por estilo e por faixa de andamento
  (à moda do iReal: < 100, 100–139, 140+), com seed. Nunca o mesmo ritmo dois compassos
  seguidos.
- Swing: razão 0,66 até 120 bpm, caindo até 0,58 em 200.
- Velocity: base = 55% da sua mediana; acento 2 e 4 (+8) no swing; ±6 de ruído. Piano de
  +6 a +12 ms atrás do beat, baixo em 0 a +3 ms; ruído ±6 ms. A cada 4 compassos, uma onda de
  ±5 de velocity, para a dinâmica respirar.
- Bateria: **fora da v1**. Um ride/hi-hat de ruído filtrado (como o `hammer()` do piano) pode
  vir na fase 7, desligado por padrão, porque o metrônomo do shred já ocupa esse papel.
- Áudio: `accompBus` (GainNode próprio → `getMasterBus()`), nível padrão 0,35. Toca **mesmo
  com o som do app em `off (external)`**, já que o acompanhamento é do app (ver perguntas).
  Timbres: piano = `schedulePianoTone`; baixo = novo `scheduleBassTone` (seno + leve 2º
  harmônico, ataque curto); pad = novo `schedulePadTone` (2 triângulos desafinados, lowpass
  ~900 Hz, release 800 ms).

### 4.6 Convivência com os modos

- **Free play**: tudo acima.
- **Shred**: não estima nada. Trava no `Transport` do exercício (bpm, compasso, beats reais) e
  usa tom e escala do exercício (`rootPc` + `pattern.source`). A oferta só aparece com o
  transporte rodando (`phase === 'playing'`), dizendo "accompany exercise?". Para isso:
  um módulo `src/stage/tempoBus.ts` onde o `handleBeat` do `Shred.tsx` publica cada `Beat`
  (uma linha; o `Transport.onBeat` é um callback único, então não dá para assinar de fora).
  As notas do app não entram na avaliação, porque não passam pelo MIDI.
- **Voicings**: sem oferta. Se algum dia, um baixo na fundamental do alvo.
- O `Transport` ganha: `clicks: false` (agendar sem metrônomo), `nudge(ms)` (correção de
  fase) e `perfToAudio()` (o inverso de `audioToPerf`, para converter tempos de MIDI em tempo
  de áudio). O acompanhamento em free play tem o seu próprio `Transport`.

## 5. Interface

Linguagem da UI em inglês, como o resto do app; identidade: fundo escuro, JetBrains Mono,
cantos retos, rótulos pequenos em caixa alta, verde `#9fe870` só onde importa.

### 5.1 Widget ao lado da marca (topbar)

```
idle        KEYTRAINER▌
listening   KEYTRAINER▌  ·                     ← um ponto cinza que pisca no pulso estimado
offer       KEYTRAINER▌  [ accompany?  B♭ major · ~92 ]  ×
                          └ clique em "B♭ major" alterna g minor / C dorian…
                          └ clique em "~92" alterna 46 / 184 (½× 2×)
offer rubato KEYTRAINER▌ [ accompany?  B♭ major · free time ]  ×
playing     KEYTRAINER▌  B♭Δ ▸ G–7   ▪▪▫▫  92 ~   ■
waiting     KEYTRAINER▌  B♭Δ · waiting for you   ■
shred       KEYTRAINER▌  [ accompany exercise?  C major · 92 locked ]  ×
```

- O ponto de `listening` é a única coisa sempre visível: `--ghost`, 4×4 px, pisca no pulso
  quando há pulso. Dá para ignorar, e ainda mostra que o app está ouvindo.
- A oferta entra com fade de 600 ms, borda 1 px `--accent-deep`, texto `--fg-soft`. Sem som
  e sem movimento depois de entrar.
- Em `playing`: o acorde atual em `--accent`, o próximo em `--dim`, a posição no compasso em
  4 quadradinhos, bpm (`92 ~` = seguindo você, `92 lock` = travado) e ■ para parar.
- Em tela estreita (a topbar quebra linha), fica só `B♭Δ ▸ G–7 ■`.

### 5.2 A folha de compassos: no lugar da notação

**Recomendação: enquanto o acompanhamento toca, a folha ocupa o slot `aside` do
`Workspace`, ou seja, o painel da notação.** Motivos: o card ao lado continua mostrando o que
**você** toca e a folha mostra o que o **app** toca, lado a lado na mesma altura dos olhos.
A pauta é o que menos importa enquanto você improvisa. E o roll e o live input continuam
sendo o seu teclado. Ao parar, a notação volta. No shred o `aside` já é do `TrainingCard`,
então lá entra uma **faixa de uma linha** (a frase atual) no `banner`, abaixo do cabeçalho
do exercício.

```
┌ CHORD CARD ─────────────────┐ ┌ ACCOMPANY · B♭ MAJOR · 92 ~ ─────── comp ▾  ◐ 2/4  ■ ┐
│                             │ │                                                      │
│   C–7                       │ │  A  │ B♭Δ      │▌G–7     ▌│ C–7      │ F7       │    │
│   minor seventh             │ │     │          │▌▪▪▫▫    ▌│          │          │    │
│                             │ │                                                      │
│   position   root           │ │  A′ │ B♭Δ      │ E♭Δ      │ D–7  G7  │ C–7  F7  │    │  ← planejada, --dim
│   root       C              │ │                                                      │
│   …                         │ │  simple ──●──── rich          tempo  follow · lock   │
└─────────────────────────────┘ └──────────────────────────────────────────────────────┘
 LIVE INPUT ……………………………………………………………………………………………………………………………………………………………
```

- 2 linhas × 4 compassos: a frase atual (texto `--fg`, compasso atual com barra lateral
  `--accent` e posição do beat) e a próxima (texto `--dim`, entra com fade quando é gerada).
  Na virada, a linha de baixo sobe.
- Letra da seção (A, A′, B) na margem; `→ E♭` no compasso de modulação; cifras com o mesmo
  estilo do card (`styleSymbol`, clicar alterna exact/jazz/simple).
- Quando você está liderando com acordes, a linha atual mostra os **seus** acordes em
  `--fg-soft` com o rótulo `you lead`.
- Cabeçalho do painel: estilo (`pad · comp · walk · even`), densidade (◐ 1/1 · 1/2),
  complexidade (o slider `simple ↔ rich`, que redesenha na hora a linha planejada), tempo
  `follow · lock`, ■ parar. Volume do acompanhamento no mesmo popover do estilo.
- Opcional (fase 7): as notas-guia (3ª e 7ª) do próximo acorde como marcas fracas no teclado,
  usando `KeyMark`, para quem quer seguir a progressão com a mão.

### 5.3 Settings

`StageSettings.accompany = { offers: boolean, style, complexity: 1..4, density: 'auto'|'1'|'2',
tempo: 'follow'|'lock', level: number, followKey: boolean }`, validado em `loadStage` como o
resto. No sidebar do free play, uma seção `accompany` com `offer to accompany` (liga/desliga
as ofertas) e os padrões; os controles do dia a dia ficam no cabeçalho da folha.

## 6. Plano em fases (cada uma entregável, testes primeiro)

**Fase 0: fixtures.** `src/accompany/fixtures.ts`: geradores com seed de fluxos sintéticos
(escala em tom/bpm, Hanon nº 1 em qualquer tom, lick menor, vamp dórico, acordes de uma
progressão, rubato, jitter configurável, pedal).

**Fase 1: tonalidade** (`keyEstimate.ts`). Testes: escala de B♭ → B♭ maior; Hanon em C → C
(não Am); lick em Sol menor → G menor; vamp em D dórico → coleção C, centro D, dórico; baixo
em A com escala de C → A menor; modulação C → G só depois de 2 compassos/4 s, nunca em 1 s;
cromatismo leve não derruba a confiança; histograma vazio → `null`.

**Fase 2: pulso** (`pulseEstimate.ts`). Testes: os 7 casos da tabela 2.2 (±2 bpm, com ½× e
2× nas alternativas); jitter de ±25 ms ainda é estável; rubato → `steadiness > 0,12`;
acordes a < 50 ms contam como um ataque; swing 2:1 detectado e colcheias retas não.

**Fase 3: ouvir e oferecer, sem som.** `listener.ts`, `machine.ts`, `AccompanyBadge.tsx`
(estados idle/listening/offer). Testes do redutor com relógio falso: oferta só depois dos
limiares; some após 15 s; × adia; nunca em voicings; shred só com transporte rodando.
Já entrega valor: o app mostra "B♭ major · ~92", e dá para calibrar os limiares tocando.

**Fase 4: planejador** (`progression.ts`, `voicing.ts`, `patterns.ts`). Testes: mesma seed →
mesma frase; toda cifra de complexidade 1–2 é diatônica; troca por função mantém a função;
complexidade só altera compassos não travados; condução ii–V–I ≤ 6 semitons somados; voicing
dentro da janela e sem segunda menor contra nota segurada; walking: tempo 4 a meio tom ou um
tom da próxima fundamental; nenhum padrão igual em dois compassos seguidos.

**Fase 5: primeiro som** (`accompanist.ts`, `LeadSheet.tsx`, mudanças no `Transport`,
`schedulePadTone`/`scheduleBassTone`). Estilos `pad` e `even`, tempo travado na estimativa,
frase A A′ B A″ mostrada na folha. Verificação manual: tocar escala de B♭ a ~90, aceitar,
conferir que entra no beat, que a folha adianta 4 compassos e que nada aparece no card nem no
shred.

**Fase 6: vivo.** `follow.ts` (testes: tempo que acelera 5% em 8 compassos é seguido com
atraso < 2 compassos; um ataque fora não mexe no período; `lock` não mexe), espera/retomada,
modulação, `you lead`, `comp` e `walk` com humanização, slider de complexidade ao vivo.

**Fase 7: shred e extras.** `tempoBus` + Viterbi sobre `expandPattern` (testes: Hanon em C
harmonizado só com diatônicos; V7 do próximo tom no último compasso com `fourths`), faixa no
`banner`, notas-guia no teclado, ride opcional.

## 7. Riscos

- **Tempo dobrado ou pela metade**: vai acontecer (Dixon). Mitigação: prior, acento e clique no bpm.
- **Arrasto mútuo de tempo**: o loop lento com mediana e o `lock` existem por causa disso. Se
  incomodar no uso real, `lock` vira o padrão.
- **"1" do compasso**: não dá para detectar com segurança. Começar na tônica torna isso quase
  inaudível, e quem se ajusta é o músico, como numa jam.
- **Soar genérico** (a crítica ao pop do iReal): é o motivo do vocabulário rítmico, da forma A A′ B A″
  e do espaço. É preciso ouvir e ajustar as tabelas de padrões à mão.
- **CPU**: pad com 3 osciladores × 4 vozes + piano de 6 parciais. Cabe; medir no Safari.
- **Safari/Firefox sem Web MIDI**: o teclado do computador passa pelo `injectRaw`, então
  funciona igual.

## 8. Perguntas para você

1. Com o som do app em `off (external)`, o acompanhamento toca mesmo assim pelo app? (recomendo sim)
2. Estilo inicial: deixar o app escolher pelo que ouve (pad/comp/even), ou sempre começar em `pad`?
3. Tempo: `follow` como padrão (lento, com mediana) ou `lock` depois de travar?
4. Só 4/4 na v1, com 3/4 manual no cabeçalho?
5. Quando você toca acordes: "você lidera, eu faço o baixo" está bom, ou prefere silêncio total?
6. No shred: oferta automática no Hanon, ou só um botão "accompany" no painel do exercício?

## 9. Roadmap

Adicionar uma linha na tabela **Free play (sidebar)** de `docs/roadmap.md`, logo abaixo de
`Harmonise`, com status `next`:

`| Accompany me | Listens in the background (key, pulse, swing); a quiet offer next to the brand; once accepted, plays soft piano + bass in time and shows an iReal-style bar grid of what comes next (in the notation slot). Tempo follows you or locks; complexity simple ↔ rich. Locks to shred's transport over exercises | next |`

O planejador (`progression.ts`) também serve às linhas `Harmonise` e `Record melody → looping
progression` do Sequencer, que passam a depender dele.
