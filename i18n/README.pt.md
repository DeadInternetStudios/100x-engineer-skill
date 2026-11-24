<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../docs/img/brand/mask-dark.png">
  <img src="../docs/img/brand/mask.png" alt="Uma máscara de Guy Fawkes" width="220">
</picture>

# 100× ENGINEER SKILL

### CHEGA DE CÓDIGO COM AGENTES QUE "QUASE FUNCIONA"

[![ci](https://github.com/DeadInternetStudios/100x-engineer-skill/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DeadInternetStudios/100x-engineer-skill/actions/workflows/ci.yml)
[![GitHub stars](https://badgen.net/github/stars/DeadInternetStudios/100x-engineer-skill?label=stars&labelColor=0b0e14&color=262e3d&style=flat)](https://github.com/DeadInternetStudios/100x-engineer-skill/stargazers)
[![release: 0.1.0](https://img.shields.io/badge/release-0.1.0-262e3d?style=flat-square&labelColor=0b0e14)](https://github.com/DeadInternetStudios/100x-engineer-skill/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-262e3d?style=flat-square&labelColor=0b0e14)](../LICENSE)
![status: beta](https://img.shields.io/badge/status-beta-ffb000?style=flat-square&labelColor=0b0e14)

<sub><a href="../README.md">English</a> · <a href="README.es.md">Español</a> · <a href="README.zh.md">中文</a> · <b>Português</b> · <a href="README.ru.md">Русский</a> · <a href="README.ja.md">日本語</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ko.md">한국어</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.bn.md">বাংলা</a> · <a href="README.it.md">Italiano</a> · <a href="README.pl.md">Polski</a> · <a href="README.th.md">ไทย</a> · <a href="README.uk.md">Українська</a> · <a href="README.nl.md">Nederlands</a></sub>

</div>

> **100x engineer**<br>
> /ˈwən ˈhən-drəd eks ˌen-jə-ˈnir/<br>
> *substantivo*
>
> Engenheiro de software a quem se atribui a produção de cem engenheiros comuns, sem as reuniões, as perguntas ou os testes falhando.

Seu agente diz que terminou. Você abre e funciona *mais ou menos*. Sempre parece estar tudo certo, mas nunca está bem pronto para publicar.

**O 100x faz seu agente de programação resolver os últimos 10% do desenvolvimento.**

É uma skill de código aberto para Claude Code, Cursor e Codex. Dê a ele um trabalho, como adicionar uma funcionalidade ao seu app ou criar um app pequeno do zero. Ele planeja o trabalho, constrói, dá o acabamento e testa a parte que mais importa. Um segundo modelo de IA revisa tudo. Você recebe um relatório com capturas de tela, resultados dos testes e o que ainda estiver em aberto.

<p align="center">
  <a href="#instalação"><img src="../docs/img/banners/pt/install.png" width="760" alt="Instalação: dois comandos e depois /100x-setup. Claude Code, Cursor ou Codex, Node 22 ou mais recente."></a>
</p>

<!-- Benchmark headline goes here: one line and one picture, the same agent with and without 100x, with a link to the method. -->

## Por que os agentes param no "quase funciona"

Três coisas dão errado, e o 100x tem uma resposta para cada uma. Todos os exemplos abaixo usam o mesmo pedido:

> Quero comparar qualquer ação com o S&P 500 no meu app de pesquisa do mercado de ações

### 1. Ninguém escreveu o que "funciona" quer dizer de verdade

O pedido tem uma linha. Antes de construir qualquer coisa, o 100x escreve o prompt que você teria escrito se tivesse uma hora sobrando. Ele define o objetivo, as regras, a parte mais arriscada e como verificar cada requisito. Aqui ele percebe a armadilha logo: um desdobramento de ações parece uma perda se o gráfico não fizer o ajuste.

<p align="center">
  <img src="../docs/img/diagrams/prompt-step.svg" width="720" alt="Você digita &quot;Quero comparar qualquer ação com o S&P 500 no meu app de pesquisa do mercado de ações&quot;, e o 100x primeiro escreve um prompt completo de cerca de 880 palavras. Um trecho. Objetivo: as duas linhas começam em 0% no primeiro dia em comum. Regra: variação percentual a partir de um início comum, não preços. Risco: um desdobramento aparece como uma perda falsa. Requisitos: 9, dois deles testes que precisam falhar primeiro. Teste difícil: um desdobramento de dois para um mostra variação de 0%. Não fazer: desenhar preços brutos num eixo comum. Momento: digite um ticker e as duas linhas começam em 0%. Juiz: uma conta feita à mão através de um desdobramento bate?">
</p>

<p align="center"><a href="../docs/examples/stock-comparison-prompt.md">Leia o prompt inteiro</a></p>

### 2. O agente confere o próprio trabalho

Um modelo que confere o próprio trabalho deixa passar os próprios erros. O 100x põe um segundo modelo para revisar o código e as telas, em rodadas. Quem constrói corrige cada apontamento ou registra por que discorda. Aqui o prompt citava o caso de uma ação recém-listada e mandava o revisor insistir nele, mas os testes do construtor só usavam ações mais antigas. O revisor testou uma ação listada este ano e viu que a linha do índice começava cinco meses antes.

<p align="center">
  <img src="../docs/img/diagrams/review-catch.svg" width="720" alt="Revisão ilustrada do gráfico de comparação de ações. Antes: a linha do S&P 500 começa 5 meses antes da linha da ação, então as duas não têm o mesmo ponto de partida. O segundo modelo aponta o problema. Depois: as duas linhas começam em 0% no primeiro dia em que ambas têm preços. Agora um teste falha se as datas de início forem diferentes, e ele passa.">
</p>

Esse exemplo é ilustrado. Um real: este README passou pelo 100x antes de você ler. O revisor apontou 9 problemas na primeira rodada, de 20 links de idioma quebrados a rótulos pequenos demais para um celular. 7 foram corrigidos e 2 ficaram para o lançamento público. [Veja o que ele encontrou](../docs/examples/readme-review.md).

### 3. O resumo vem da memória

Quando um agente diz "pronto", ele relata o que lembra. O 100x guarda as evidências no caminho: capturas de tela, saída dos testes, os apontamentos do revisor. No fim, um código escreve o resumo a partir desses arquivos, e o `100x finish` se recusa a escrevê-lo enquanto algum requisito estiver sem evidência ou faltar alguma verificação. Esta é a mensagem do fim da execução do gráfico de ações. O app de pesquisa é inventado, então a execução é ilustrada.

<p align="center">
  <img src="../docs/img/diagrams/final-message.svg" width="560" alt="A mensagem final da execução ilustrada do gráfico de ações, impressa pelo 100x finish a partir dos resultados salvos. O mesmo texto vem logo abaixo como texto simples.">
</p>

<details>
<summary>A mesma mensagem como texto simples</summary>

```text
Compare with the S&P 500: A chart in a research app that shows how any stock has moved against the S&P 500 since the first day both have prices. Verdict: ready to ship. The split math matches a hand count and both lines start on the same day. Dividends are not counted yet.
The moment: Type a ticker and both lines start at 0% on the same day, so the gap is the whole story
Run: npm run dev, then open http://localhost:5173/compare
Try first: 1) Type a ticker you hold and read the gap to the index 2) Pick a stock that split two for one and check the split day shows no drop 3) Pick a stock listed this year and see where both lines start
Must not break: numbers passed (Percent change across a two-for-one split matches a hand count on 40 split cases, 0 failing)
Review (claude-opus-5-5): 9 flagged, 7 fixed, 1 rejected, 1 deferred
Judge rounds: 5 of 5 done, on the code and how it behaves, the UI and UX and whether it is ready to ship, and the last word was ready to ship
Screen sizes: 0 broken, 2 weak, 15 sizes and 148 elements checked
Asks: 9 of 9 closed
Report: file:///Users/you/projects/research-app/.100x/REPORT.html
Next likely asks: Count dividends in the comparison; Show the gap for several stocks in one table
```

</details>

- **The moment:** a única coisa que deveria fazer você querer usar
- **Must not break:** o teste difícil, e se ele passou
- **Review:** o que o segundo modelo apontou e o que o construtor fez com isso
- **Asks:** os requisitos do prompt, cada um fechado só com evidência
- **Next likely asks:** o que você provavelmente pediria em seguida, já construído ou listado

## Mande uma mensagem e vá embora

O mesmo pedido como linha do tempo. Na mão, você precisa voltar toda hora para responder perguntas e pegar erros. Com o 100x, você manda uma mensagem e lê o relatório quando voltar. Azul é você e âmbar é o segundo modelo. Os horários são inventados.

<p align="center">
  <img src="../docs/img/diagrams/by-hand-feature.svg" width="720" alt="Execução ilustrada que adiciona um gráfico de comparação de ações. Na mão você manda cinco mensagens e volta para encontrar uma pergunta sobre históricos de preço mais curtos. Com o 100x você manda um único pedido. O agente testa que um desdobramento de dois para um não mostra perda, e um segundo modelo pega uma diferença nas datas de início do gráfico. O relatório mostra o gráfico corrigido e os resultados dos testes.">
</p>

<details>
<summary>O mesmo num app pequeno criado do zero</summary>

<p align="center">
  <img src="../docs/img/diagrams/by-hand-app.svg" width="720" alt="Construção noturna ilustrada. Na mão você manda cinco mensagens e acorda com uma pergunta sobre o banco de dados. Com o 100x você manda um único briefing, o relatório fica pronto às 2h15 da madrugada e você testa o app de orçamento de manhã.">
</p>

O prompt do app de orçamento, escrito a partir de quatro palavras: [make me a budget app](../docs/examples/budget-app-prompt.md).

</details>

<details>
<summary>Os oito passos de uma execução</summary>

| Passo | O que acontece |
|---|---|
| 1. Plano | Seu agente escreve um prompt detalhado. Ele diz o que construir e como verificar cada pedido. |
| 2. Núcleo | Ele tenta primeiro a parte mais arriscada, enquanto ainda dá tempo de mudar o plano. |
| 3. Construção | Ele constrói a primeira versão e os extras que você provavelmente vai pedir em seguida. |
| 4. Acabamento | Ele trabalha o layout e os detalhes. Um segundo modelo olha capturas de tela depois de cada passada e aponta o que está fraco. |
| 5. Teste | O agente testa a única coisa que estragaria o trabalho se quebrasse, como um gráfico errando um desdobramento. Primeiro ele mostra que o teste consegue pegar um erro. |
| 6. Revisão | O segundo modelo revisa o código e as telas. O construtor corrige cada problema ou registra por que ele pode esperar ou por que discorda. |
| 7. Fechamento | O comando `100x finish` confere as evidências salvas antes de escrever o relatório. |
| 8. Relatório | Você vê o resultado, testa por conta própria e lê o que o revisor encontrou. |

Se você não estiver por perto, o agente anota cada decisão que toma e continua trabalhando. [Leia o fluxo completo](../docs/pipeline.md).

</details>

## O que você recebe

<div align="center">

<img src="../docs/img/morning-gallery.jpg" alt="A página de relatório: três protótipos prontos, cada um com uma imagem, uma frase dizendo o que é, um veredito, os motivos do juiz quando ele disse não, o momento que faz valer a pena dar uma olhada e um jeito de rodar" width="900">

<sub>A página de relatório, gerada a partir de três execuções inventadas. Uma execução real coloca as próprias capturas de tela em cada cartão.</sub>

</div>

- **A funcionalidade ou o app**, e como testar por conta própria
- **Capturas de tela em vários tamanhos de tela**, verificadas quanto a texto vazando, botões minúsculos, imagens borradas e erros do navegador
- **Uma página de relatório** (`.100x/REPORT.html`) e uma galeria com todas as execuções concluídas em `~/.100x`
- **Um registro de decisões**: cada escolha que o 100x fez enquanto você estava fora, e por quê
- **A mensagem final** mostrada acima

Cada execução recebe um veredito: **Pronto para publicar**, **Ok** ou **Precisa de ajustes**. Quando algo impede um veredito, o cartão diz o quê, em vermelho quando o 100x encontrou um problema e em âmbar quando falta uma verificação.

---

<div align="center">

## Produtos reais feitos com 100x

<table align="left"><tr><td>
<a href="https://dollarflow.com/"><img src="../docs/img/built/shot-dollarflow.jpg" alt="DollarFlow: como o Bloomberg Terminal, mas para pessoas normais. A Tesla é negociada 25% acima do seu valor justo, comparada com o próprio histórico, os concorrentes mais próximos e todas as empresas." width="380"></a><br>
<a href="https://dollarflow.com/"><b>DollarFlow</b></a><br>
Um screener de ações, feito<br>
com ajuda do 100x
</td></tr></table>
<table align="left"><tr><td>
<a href="https://springtails.wiki/"><img src="../docs/img/built/shot-springtails.jpg" alt="Springtails Wiki: colêmbolos, com as evidências. Páginas de espécies, fichas de cuidados, um jogo idle e um explorador de anatomia em 3D." width="380"></a><br>
<a href="https://springtails.wiki/"><b>Springtails Wiki</b></a><br>
Uma wiki sobre colêmbolos, feita<br>
inteiramente com 100x
</td></tr></table>
<br clear="all">

<table align="left"><tr><td>
<a href="https://bubblewrapapp.com/"><img src="../docs/img/built/shot-bubblewrap.jpg" alt="BubbleWrap: uma grade de bolhas em pixel art que tocam música quando estouradas, com uma lista de faixas, efeitos e um mixer." width="380"></a><br>
<a href="https://bubblewrapapp.com/"><b>BubbleWrap</b></a><br>
Um app de música em pixel art,<br>
feito inteiramente com 100x
</td></tr></table>
<table align="left"><tr><td>
<a href="https://goldtraderdesk.com/"><img src="../docs/img/built/shot-goldtraderdesk.jpg" alt="Gold Trader Desk: um gráfico ao vivo do preço XAU/USD com os próximos eventos e um painel para contestar uma operação." width="380"></a><br>
<a href="https://goldtraderdesk.com/"><b>Gold Trader Desk</b></a><br>
Um app para operar ouro, feito<br>
inteiramente com 100x
</td></tr></table>
<br clear="all">

<table align="left"><tr><td>
<img src="../docs/img/built/shot-phantom.jpg" alt="Phantom: uma assinatura com traços de caneta numerados sobre uma foto, com uma lista de imagens à esquerda e os traços à direita." width="380"><br>
<b>Phantom</b><br>
Um app para Mac em Swift que peritos<br>
forenses usam para analisar<br>
caligrafia, feito com ajuda<br>
do 100x
</td></tr></table>
<table align="left"><tr><td>
<img src="../docs/img/built/shot-optionsflow.jpg" alt="OptionsFlow: uma tabela de cadeia de opções com calls e puts por strike ao lado de um gráfico de lucro e prejuízo." width="380"><br>
<b>OptionsFlow</b><br>
Uma ferramenta de cadeia de opções em<br>
tempo real em React usada por fundos<br>
quantitativos, feita com ajuda do 100x
</td></tr></table>
<br clear="all">

<table align="left"><tr><td>
<img src="../docs/img/built/shot-skynet.jpg" alt="Skynet: uma tela inicial escura com uma lista de apps no topo, um item que precisa de atenção, um grafo de rede e blocos de incidentes, máquinas, compromissos e execuções." width="380"><br>
<b>Skynet</b><br>
Uma ferramenta de gestão de projetos<br>
feita sobre Blueprint e Encore, com<br>
ajuda do 100x
</td></tr></table>
<table align="left"><tr><td>
<img src="../docs/img/built/shot-boneworks.jpg" alt="Boneworks: seis passos que vão de um briefing de uma frase a uma imagem, um modelo 3D, um esqueleto com pele, animações e o personagem dentro de um jogo." width="380"><br>
<b>Boneworks</b><br>
Um pipeline de texto para 3D que modela,<br>
aplica pele, faz o rig e anima personagens,<br>
feito com ajuda do 100x
</td></tr></table>
<br clear="all">

<p align="center">
  <a href="mailto:theory@deadinternet.com"><img src="../docs/img/banners/pt/built.png" width="760" alt="Projetos: fez algo com o 100x? Mande para theory@deadinternet.com"></a>
</p>

</div>

---

## Quanto custa

O 100x troca tempo e uso por provas.

- **Uma execução normal leva horas.** Cada passada de acabamento e cada rodada de revisão é mais um modelo trabalhando, então uma execução consome boa parte do seu plano.
- **Para uma primeira olhada**, o `/100x-mockup` leva cerca de 15 minutos. Ele pula a revisão e avisa isso.
- **Num plano menor**, `100x config preset lite --global` faz uma passada de acabamento e duas rodadas de revisão em vez de três e cinco. As verificações de prova continuam.
- **Não é para coisas pequenas.** Para uma correção de uma linha ou uma pergunta, peça direto ao seu agente. O 100x é para um trabalho que merece um plano, um teste e uma revisão.

## Instalação

Você precisa de Claude Code, Cursor ou Codex, e Node.js 22 ou mais recente.

**1. Instale a ferramenta e as skills**

Escolha uma:

**npm**

```bash
npm install -g github:DeadInternetStudios/100x-engineer-skill
100x install
```

**skills.sh**

```bash
npm install -g github:DeadInternetStudios/100x-engineer-skill
npx skills add DeadInternetStudios/100x-engineer-skill --skill '*' -g
100x install
```

A ferramenta `skills` só copia as skills, então a ferramenta `100x` continua vindo do npm. Depois, `100x install` vê as cópias e não mexe nelas. Atualize com `npx skills update -g`.

**2. Configure, no seu agente**

```text
/100x-setup
```

Ele pergunta qual é o seu plano (Claude Pro, Max ou Ultra, ou OpenAI Go, Plus ou Pro) e escolhe qual modelo constrói e qual julga. Se o seu plano for pequeno, diga isso e ele ativa o preset lite. Mais: [docs/plans-and-setup.md](../docs/plans-and-setup.md).

**3. Dê um trabalho a ele**

```text
/100x Quero comparar qualquer ação com o S&P 500 no meu app de pesquisa do mercado de ações
```

Claude Code e Cursor iniciam uma skill com `/`. O Codex usa `$`, como em `$100x-setup` e `$100x`. Use `/100x-overnight` quando for sair durante a noite, ou `/100x-mockup` para uma primeira olhada.

### Outras formas de instalar

**A partir de um clone** (é assim que testamos este repo)

```bash
./scripts/install.sh --dry-run   # preview
./scripts/install.sh
```

O 100x tem duas partes: as skills que seu agente lê e a ferramenta de linha de comando `100x`. A ferramenta faz o que um modelo não consegue fazer com confiança sozinho. Ela controla o relógio, tira capturas de tela, roda o juiz, confere as provas e escreve o relatório. As capturas usam Playwright. Se ele não estiver instalado, `100x browsers` instala.

O instalador só cria atalhos (links simbólicos), alguns arquivos pequenos e as pastas deles. Ele nunca sobrescreve um arquivo real. `100x doctor` confere o resultado, e `./scripts/install.sh --uninstall` remove tudo. Todos os arquivos que ele mexe: [docs/cli.md](../docs/cli.md).

## Modos

O 100x é um conjunto de skills, chamadas modos. Digite o nome de um modo para usá-lo. As palavras da sua mensagem nunca escolhem um modo, então `/100x an overnight oats app` constrói um app de aveia.

| Digite isto | Para | O que faz |
|---|---|---|
| `/100x` | Construir | A execução normal: construir, dar acabamento, testar, revisão por um segundo modelo. |
| `/100x-mockup` | Construir | Uma primeira olhada rápida em cerca de 15 minutos. Só o momento principal funciona. Sem revisão, e ele avisa (UNREVIEWED). |
| `/100x-overnight` | Construir | Para quando você vai sair. Roda uma ideia ou várias, por um tempo definido, e dá um empurrão no agente se ele travar. |
| `/100x-wrapup` | Construir | Para prazos. Faz o caminho principal funcionar e esconde o resto. |
| `/100x-judge` | Revisar | Revisa algo que já foi construído. Não constrói nada novo. |
| `/100x-grind` | Revisar | Revisar, corrigir e revisar de novo até um juiz dizer que está pronto para publicar. Para se três revisões seguidas não acharem nada melhor, em 15 rodadas ou quando o tempo acabar. |
| `/100x-status` | Uma execução | Em que ponto a execução está, em seis linhas ou menos. |
| `/100x-continue` | Uma execução | Retoma uma execução que parou, por exemplo num limite de uso. |
| `/100x-report` | Uma execução | Mostra tudo o que terminou, o melhor primeiro. Não constrói nada. |
| `/100x-adhd` | Planejar | Uma conversa curta, uma pergunta por vez, que transforma uma ideia solta num plano. Nada é construído até você dar o sinal. |
| `/100x-setup` | Configuração | Faz uma pergunta sobre o seu plano e depois define qual modelo faz cada trabalho. |
| `/100x-bakeoff` | Testar o 100x | Testa o próprio 100x: o mesmo agente constrói as mesmas ideias com e sem ele, e um juiz às cegas compara. Não constrói nada. |

### Frases com números

Adicione estas frases à sua mensagem para mudar uma execução. Elas funcionam com `/100x` e `/100x-overnight`. Outras palavras, como "fast" ou "quick", não fazem nada.

| Você escreve | O que acontece |
|---|---|
| `3 versions` | Constrói 3 versões da ideia e termina a melhor. Qualquer número funciona. |
| `for 10 hours`, `for 2 days`, `until 6am` | Usa todo esse tempo. A execução não termina antes. |
| `5 rounds of judging` | Roda esse número de rodadas de revisão. |
| `max 5 subagents` | No máximo 5 subagentes ao mesmo tempo. O padrão é 1. |

```text
/100x-overnight 3 versions of a farming game, for 8 hours, max 3 subagents
```

Cada execução começa listando as frases que entendeu, para você notar se algo foi mal interpretado.

Dê um relógio a ele e ele continua trabalhando em rodadas até o tempo acabar. Cada rodada olha o projeto de um jeito novo, mantém a mudança se ajudou e desfaz se não ajudou. Um segundo modelo novo confere cada rodada.

<p align="center">
  <img src="../docs/img/diagrams/overnight.svg" width="720" alt="Você digita: /100x-overnight a farming game, for 8 hours. Depois da primeira execução completa, o 100x trabalha em rodadas até o relógio acabar: olhos novos, tentar quebrar, teste difícil e mais. Cada rodada termina com um segundo modelo novo conferindo. O finish se recusa até o relógio acabar, e depois vem o relatório.">
</p>

## Perguntas frequentes

**Por que um segundo modelo?** Modelos diferentes têm pontos cegos diferentes. Se nenhum estiver disponível, a execução termina mesmo assim e diz UNREVIEWED. Com um único plano, um modelo menor da mesma empresa pode julgar, com menos benefício do que um modelo de outra empresa.

**Ele vai colocar meu projeto no ar?** Não. Ele só cria uma prévia se o projeto já tiver uma. Para ir ao ar, você precisa pedir.

**E se eu bater num limite de uso no meio de uma execução?** O 100x salva o progresso em `.100x/STATE.md`. Quando o limite zerar, digite `/100x-continue` na mesma pasta.

**Ele muda meu modelo ou minhas configurações?** Não. Ele nunca troca seu modelo, nível de esforço ou login. O `/100x-setup` só escreve as configurações do próprio 100x.

**Onde ficam as execuções?** Numa pasta oculta `.100x/` em cada projeto (o git ignora), e numa galeria de execuções concluídas em `~/.100x`.

<p align="center">
  <a href="https://github.com/DeadInternetStudios/100x-engineer-skill/issues/new"><img src="../docs/img/banners/pt/issue.png" width="760" alt="Issues: uma execução deu errado? Conte o que você digitou e o que aconteceu."></a>
</p>

## Documentação

| Página | O que tem nela |
|---|---|
| [Instalação completa](../docs/install.md) | todas as opções de instalação e todos os arquivos que o instalador mexe |
| [Usando o 100x](../docs/using.md) | uma noite fora, a página de relatório, a skill de ajuda |
| [Pipeline e mensagem final](../docs/pipeline.md) | cada passo em detalhe, e o que o `100x finish` confere |
| [Configuração e planos](../docs/plans-and-setup.md) | a configuração recomendada do Claude Code, o preset lite, configurações para cada plano |
| [Configurações](../docs/settings.md) | todas as chaves de configuração |
| [CLI e estrutura de arquivos](../docs/cli.md) | todos os comandos `100x` e onde ficam os arquivos |
| [Por dentro das skills, verificação](../docs/contributing.md) | como o repo está organizado e como testá-lo |
| [Notas de design](../docs/design.md) | por que o 100x funciona assim |

## Como contribuir

Relatos de bugs, correções e ideias são bem-vindos. Correções pequenas podem ir direto para um pull request. Para algo maior, abra uma issue antes para a gente combinar. [Como contribuir](../CONTRIBUTING.md).

<p align="center">
  <a href="../CONTRIBUTING.md"><img src="../docs/img/banners/pt/contribute.png" width="760" alt="Contribuir: ajude a melhorar o 100x. Correções, verificações, documentação, traduções."></a>
</p>

## Créditos

O 100x se baseia nos princípios de trabalho do [pstack](https://github.com/cursor/plugins/tree/main/pstack), de Lauren Tan (MIT), adaptados para protótipos e para uma única conversa com seu agente. O que muda:

- Toda execução termina com uma página de relatório.
- O `100x finish` recusa afirmações que não consegue verificar.
- Um segundo modelo revisa o trabalho em rodadas.

Veja [NOTICE.md](../NOTICE.md) e [UPSTREAM.md](../UPSTREAM.md).

MIT. Veja [LICENSE](../LICENSE).

<p align="center">
  <a href="https://star-history.com/#DeadInternetStudios/100x-engineer-skill&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=deadinternetstudios/100x-engineer-skill&type=Date&theme=dark">
      <img src="https://api.star-history.com/svg?repos=deadinternetstudios/100x-engineer-skill&type=Date" width="600" alt="Star history">
    </picture>
  </a>
</p>

---

<sub>Arte da máscara: <a target="_blank" href="https://www.vexels.com/png-svg/preview/229802/guy-fawkes-mask-bonfire-night-stroke">www.vexels.com</a></sub>
