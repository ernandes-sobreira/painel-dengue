// Painel Dengue — Ernandes Sobreira
// Fonte: DATASUS/SINAN (TABNET) — Leitura de CSV "cru" + análises (2014+)

const $ = (id)=>document.getElementById(id);

const els = {
  layer: $("layer"),
  uf: $("uf"),
  mun: $("mun"),
  y0: $("y0"),
  y1: $("y1"),
  cat: $("cat"),
  question: $("question"),
  btnRun: $("btnRun"),
  btnReload: $("btnReload"),
  btnExportView: $("btnExportView"),
  status: $("status"),
  answer: $("answer"),
  kpiTotal: $("kpiTotal"),
  kpiMean: $("kpiMean"),
  kpiPeak: $("kpiPeak"),
  kpiTrend: $("kpiTrend"),
  chart: $("chart"),
  table: $("table"),
};

let chart = null;

// ===== Helpers =====
function setStatus(msg){ els.status.textContent = msg; }
function fmt(n){
  const v = Math.round(Number(n||0));
  return new Intl.NumberFormat("pt-BR").format(v);
}
function pct(x){
  if (!Number.isFinite(x)) return "—";
  const v = x*100;
  const s = (v>=0?"+":"") + v.toFixed(1).replace(".",",") + "%";
  return s;
}
function uniq(arr){ return [...new Set(arr)]; }
function clampYearRange(y0,y1){ return [Math.min(y0,y1), Math.max(y0,y1)]; }

function safeNum(v){
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s || s === "-" ) return 0;
  // números TABNET costumam ser inteiros
  const cleaned = s.replace(/\./g,"").replace(/,/g,".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Lê tabela TABNET (CSV semicolon) ignorando cabeçalho/rodapé.
function parseTabnetCSV(text){
  const lines = text.split(/\r?\n/);

  // achar a primeira linha que parece "header" da tabela
  // regra: começa com aspas, tem ';' e tem "Total" OU tem muitos campos
  let headerIdx = -1;
  for (let i=0;i<Math.min(lines.length,200);i++){
    const l = lines[i];
    if (l && l.startsWith('"') && l.includes(';') && (l.includes('"Total"') || l.toLowerCase().includes('total"'))){
      headerIdx = i; break;
    }
  }
  if (headerIdx < 0) throw new Error("Não encontrei o cabeçalho TABNET no CSV.");

  // cortar até antes de "Fonte:" (ou " Notas:")
  let endIdx = lines.length;
  for (let i=headerIdx+1;i<lines.length;i++){
    const l = lines[i] || "";
    if (l.includes("Fonte:") || l.includes(" Fonte:") || l.includes("Notas:") || l.includes(" Notas:")){
      endIdx = i;
      break;
    }
  }

  const slice = lines.slice(headerIdx, endIdx).join("\n");
  const parsed = Papa.parse(slice, {
    header: true,
    skipEmptyLines: true,
    delimiter: ";",
    quoteChar: '"'
  });

  // normalizar cabeçalhos (sem mexer no texto original)
  const rows = (parsed.data || []).map(r => {
    const out = {};
    for (const k of Object.keys(r)){
      out[String(k).trim()] = r[k];
    }
    return out;
  });

  return rows;
}

function linearTrend(years, values){
  // regressão linear simples y = a + b*x
  // retorna slope b (casos/ano), r2, classificação e % mudança entre primeiro e último ano
  const n = years.length;
  if (n < 2) return { slope: 0, r2: 0, label: "insuficiente", pctChange: 0 };

  const x = years.map(Number);
  const y = values.map(v => Number(v||0));

  const xMean = x.reduce((a,b)=>a+b,0)/n;
  const yMean = y.reduce((a,b)=>a+b,0)/n;

  let num=0, den=0;
  for (let i=0;i<n;i++){
    num += (x[i]-xMean)*(y[i]-yMean);
    den += (x[i]-xMean)*(x[i]-xMean);
  }
  const slope = den === 0 ? 0 : num/den;
  const intercept = yMean - slope*xMean;

  // r2
  let ssTot=0, ssRes=0;
  for (let i=0;i<n;i++){
    const yiHat = intercept + slope*x[i];
    ssTot += (y[i]-yMean)**2;
    ssRes += (y[i]-yiHat)**2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - (ssRes/ssTot);

  const first = y[0];
  const last = y[n-1];
  const pctChange = (first === 0) ? (last>0 ? Infinity : 0) : (last-first)/first;

  // classificar tendência (simples e pragmática)
  // usa slope relativo à média anual para evitar "qualquer slope vira crescente"
  const rel = (yMean === 0) ? 0 : slope / yMean; // por ano
  let label = "estável";
  if (rel > 0.03) label = "crescente";
  if (rel < -0.03) label = "decrescente";

  return { slope, r2, label, pctChange };
}

function buildAnswerBlock(title, bullets, footer){
  const ul = bullets.map(b=>`<li>${b}</li>`).join("");
  return `
    <div class="answerTitle"><b>${title}</b></div>
    <ul>${ul}</ul>
    <div class="muted" style="margin-top:8px">${footer}</div>
  `;
}

function setKPIs(values, trendObj){
  const total = values.reduce((a,b)=>a+b,0);
  const mean = values.length ? total/values.length : 0;
  const peak = values.length ? Math.max(...values) : 0;

  els.kpiTotal.textContent = fmt(total);
  els.kpiMean.textContent = fmt(mean);
  els.kpiPeak.textContent = fmt(peak);

  const t = trendObj || {label:"—", slope:0, r2:0, pctChange:0};
  const trendTxt = (t.label==="insuficiente")
    ? "insuficiente"
    : `${t.label} (${pct(t.pctChange)}; R² ${t.r2.toFixed(2).replace(".",",")})`;
  els.kpiTrend.textContent = trendTxt;
}

function renderChart(kind, labels, datasets, title){
  if (chart) chart.destroy();
  chart = new Chart(els.chart, {
    type: kind,
    data: { labels, datasets },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      interaction:{ mode:"index", intersect:false },
      plugins:{
        legend:{ display:true },
        title:{ display: !!title, text: title }
      },
      scales:{
        y:{ ticks:{ callback:(v)=>fmt(v) } }
      }
    }
  });
}

function renderTable(headers, rows){
  const thead = els.table.querySelector("thead");
  const tbody = els.table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trh = document.createElement("tr");
  headers.forEach(h=>{
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  rows.forEach(r=>{
    const tr = document.createElement("tr");
    headers.forEach(h=>{
      const td = document.createElement("td");
      td.textContent = r[h] ?? "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function downloadCSVFromTable(filename){
  const thead = els.table.querySelectorAll("thead th");
  const headers = [...thead].map(th=>th.textContent);

  const trs = els.table.querySelectorAll("tbody tr");
  const lines = [];
  lines.push(headers.join(","));
  trs.forEach(tr=>{
    const tds = tr.querySelectorAll("td");
    const row = [...tds].map(td=>{
      const s = String(td.textContent ?? "");
      const quoted = `"${s.replace(/"/g,'""')}"`;
      return quoted;
    });
    lines.push(row.join(","));
  });

  const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ===== Data loading =====
const DATA_FILES = {
  br: "data/dados-dengue.csv",
  uf: "data/dados-dengue-estados.csv",
  mun: "data/dados-dengue-municipios.csv",
  sexo: "data/dados-dengue-sexo.csv",
  raca: "data/dados-dengue-raca.csv",
  esc: "data/dados-dengue-escolaridade.csv",
  faixa: "data/dados-dengue-faixa-etaria.csv",
};

let DB = {
  brMensal: null,         // [{ano, meses{Jan..Dez, Ign}, total}]
  ufAno: null,            // [{uf, ano, casos}]
  munAno: null,           // [{uf, municipio, ano, casos}]
  perfil: {               // por ano e categoria
    sexo: null,           // [{ano, cat, casos}]
    raca: null,
    esc: null,
  },
  faixaMes: null          // [{faixa, mes, casos}] (sem ano)
};

async function fetchText(url){
  const resp = await fetch(url, { cache:"no-store" });
  if (!resp.ok) throw new Error(`Falha ao carregar: ${url}`);
  return await resp.text();
}

function toYear(n){
  const y = Number(String(n).replace(/"/g,"").trim());
  return Number.isFinite(y) ? y : NaN;
}

const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function buildBrMensal(rows){
  // colunas: "Ano 1 Sintoma(s)", "Ign/Em Branco", meses, Total
  const keyAno = Object.keys(rows[0]).find(k=>k.toLowerCase().includes("ano"));
  const keyIgn = Object.keys(rows[0]).find(k=>k.toLowerCase().includes("ign"));
  const keyTot = Object.keys(rows[0]).find(k=>k.toLowerCase().includes("total"));

  const out = [];
  rows.forEach(r=>{
    const ano = toYear(r[keyAno]);
    if (!Number.isFinite(ano) || ano < 2014) return;
    const meses = {};
    MONTHS.forEach(m=> meses[m] = safeNum(r[m]));
    meses["Ign"] = safeNum(r[keyIgn]);
    const total = safeNum(r[keyTot]);
    out.push({ ano, meses, total });
  });
  out.sort((a,b)=>a.ano-b.ano);
  return out;
}

function buildUF(rows){
  // primeira coluna é UF, outras colunas são anos + Total
  const cols = Object.keys(rows[0]);
  const colUF = cols[0];
  const yearCols = cols.filter(c => /^\d{4}$/.test(c)).map(Number).filter(y=>y>=2014);

  const out = [];
  rows.forEach(r=>{
    const ufRaw = String(r[colUF] ?? "").replace(/"/g,"").trim();
    if (!ufRaw) return;
    const uf = ufRaw.split(" ").slice(-1)[0]; // pega sigla/numero final? aqui a UF vem "51 Mato Grosso" etc
    // melhor: manter o texto inteiro e também a sigla se existir; como não tem sigla, manter nome
    // vamos manter "UF de residência" como texto.
    yearCols.forEach(y=>{
      out.push({ uf: ufRaw, ano: y, casos: safeNum(r[String(y)]) });
    });
  });

  return { out, ufs: uniq(out.map(d=>d.uf)).sort(), years: yearCols.sort((a,b)=>a-b) };
}

function buildMunicipios(rows){
  // primeira coluna municipio, outras colunas anos
  const cols = Object.keys(rows[0]);
  const colMun = cols[0];
  const yearCols = cols.filter(c => /^\d{4}$/.test(c)).map(Number).filter(y=>y>=2014);

  // município vem com código + nome (ex: "110001 ALTA FLORESTA D'OESTE")
  // UF não vem separado aqui; então UF será extraída do código IBGE (2 primeiros dígitos = UF numérica),
  // mas como o usuário quer por UF nominal, manteremos o filtro por "UF numérica" e por "texto"
  // (Sem base extra para mapear número->sigla, então exibimos como "11", "12"... e opcionalmente você pode depois mapear.)
  function ufFromIBGE(m){
    const m2 = m.trim().replace(/"/g,"");
    const code = m2.split(" ")[0];
    const ufNum = code && /^\d{6}/.test(code) ? code.slice(0,2) : "";
    return ufNum || "??";
  }

  const out = [];
  rows.forEach(r=>{
    const munRaw = String(r[colMun] ?? "").replace(/"/g,"").trim();
    if (!munRaw || munRaw.toLowerCase().includes("ign")) return;

    const ufNum = ufFromIBGE(munRaw);
    yearCols.forEach(y=>{
      out.push({ uf: ufNum, municipio: munRaw, ano: y, casos: safeNum(r[String(y)]) });
    });
  });

  const ufs = uniq(out.map(d=>d.uf)).sort((a,b)=>a.localeCompare(b));
  return { out, ufs, years: yearCols.sort((a,b)=>a-b) };
}

function buildPerfil(rows, kind){
  // primeira coluna: Ano, outras colunas: categorias, última: Total
  const cols = Object.keys(rows[0]);
  const colAno = cols[0];
  const catCols = cols.filter(c => c !== colAno && !c.toLowerCase().includes("total"));

  const out = [];
  rows.forEach(r=>{
    const ano = toYear(r[colAno]);
    if (!Number.isFinite(ano) || ano < 2014) return;
    catCols.forEach(cat=>{
      out.push({ kind, ano, cat, casos: safeNum(r[cat]) });
    });
  });

  const cats = uniq(out.map(d=>d.cat)).sort();
  const years = uniq(out.map(d=>d.ano)).sort((a,b)=>a-b);
  return { out, cats, years };
}

function buildFaixa(rows){
  // primeira coluna: faixa etária, colunas meses, total
  const cols = Object.keys(rows[0]);
  const colFaixa = cols[0];
  const out = [];

  rows.forEach(r=>{
    const faixa = String(r[colFaixa] ?? "").replace(/"/g,"").trim();
    if (!faixa) return;
    if (faixa.toLowerCase().includes("total")) return;

    MONTHS.forEach(m=>{
      out.push({ faixa, mes: m, casos: safeNum(r[m]) });
    });
  });

  const faixas = uniq(out.map(d=>d.faixa)).sort();
  return { out, faixas, months: MONTHS.slice() };
}

async function loadAll(){
  setStatus("Carregando CSVs do DATASUS…");

  const [tBr,tUF,tMun,tSexo,tRaca,tEsc,tFaixa] = await Promise.all([
    fetchText(DATA_FILES.br),
    fetchText(DATA_FILES.uf),
    fetchText(DATA_FILES.mun),
    fetchText(DATA_FILES.sexo),
    fetchText(DATA_FILES.raca),
    fetchText(DATA_FILES.esc),
    fetchText(DATA_FILES.faixa),
  ]);

  const brRows = parseTabnetCSV(tBr);
  DB.brMensal = buildBrMensal(brRows);

  const ufRows = parseTabnetCSV(tUF);
  const ufObj = buildUF(ufRows);
  DB.ufAno = ufObj;

  const munRows = parseTabnetCSV(tMun);
  const munObj = buildMunicipios(munRows);
  DB.munAno = munObj;

  const sexoRows = parseTabnetCSV(tSexo);
  DB.perfil.sexo = buildPerfil(sexoRows, "sexo");

  const racaRows = parseTabnetCSV(tRaca);
  DB.perfil.raca = buildPerfil(racaRows, "raca");

  const escRows = parseTabnetCSV(tEsc);
  DB.perfil.esc = buildPerfil(escRows, "esc");

  const faixaRows = parseTabnetCSV(tFaixa);
  DB.faixaMes = buildFaixa(faixaRows);

  setupUI();
  setStatus("Pronto. Selecione a camada e clique em Responder.");
}

// ===== UI setup =====
function fillSelect(sel, values, placeholder){
  sel.innerHTML = "";
  if (placeholder){
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholder;
    sel.appendChild(opt0);
  }
  values.forEach(v=>{
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

function setupYears(years){
  fillSelect(els.y0, years.map(String));
  fillSelect(els.y1, years.map(String));
  els.y0.value = String(Math.max(2014, years[0]));
  els.y1.value = String(years[years.length-1]);
}

function setupQuestions(layer){
  const qs = [];

  if (layer === "br"){
    qs.push({ id:"trend_total", label:"Os casos (Brasil) estão crescendo ou diminuindo?" });
    qs.push({ id:"peak_year", label:"Quais anos têm mais e menos casos (Brasil)?" });
    qs.push({ id:"peak_month", label:"Quais meses têm mais e menos casos (Brasil)?" });
  } else if (layer === "uf"){
    qs.push({ id:"trend_geo", label:"Na UF selecionada: está crescendo ou diminuindo?" });
    qs.push({ id:"top_geo", label:"Quais UFs têm mais casos (no período)?" });
  } else if (layer === "mun"){
    qs.push({ id:"trend_geo", label:"No município selecionado: está crescendo ou diminuindo?" });
    qs.push({ id:"top_geo", label:"Quais municípios têm mais casos (no período)?" });
  } else if (layer === "sexo" || layer === "raca" || layer === "esc"){
    qs.push({ id:"trend_cat", label:"A categoria selecionada está aumentando ou diminuindo?" });
    qs.push({ id:"compare_all", label:"Comparar todas as categorias (no período)" });
    qs.push({ id:"top_cat", label:"Qual categoria concentra mais casos (no período)?" });
  } else if (layer === "faixa"){
    qs.push({ id:"peak_month_by_age", label:"Em cada faixa etária: quais meses têm mais/menos casos?" });
    qs.push({ id:"top_age", label:"Quais faixas etárias têm mais casos (total)?" });
  }

  fillSelect(els.question, qs.map(q=>q.id), null);
  // trocar texto mostrado
  // hack: recriar options com labels
  els.question.innerHTML = "";
  qs.forEach(q=>{
    const opt = document.createElement("option");
    opt.value = q.id;
    opt.textContent = q.label;
    els.question.appendChild(opt);
  });
}

function setupUI(){
  // anos base: unir anos disponíveis (prioriza 2014+)
  const yearsGeo = DB.ufAno.years; // 2014..2025
  setupYears(yearsGeo);

  // UF (estados): aqui a coluna vem como "35 São Paulo", etc (não sigla)
  fillSelect(els.uf, DB.ufAno.ufs, "Selecione…");
  els.uf.disabled = true;

  // Municípios: UF numérica (2 dígitos). Sem mapear pra sigla automaticamente.
  // Para começar, vamos filtrar por UF numérica; município depende da UF numérica.
  fillSelect(els.mun, [], "Selecione…");
  els.mun.disabled = true;

  setupQuestions(els.layer.value);
  onLayerChange();
}

function onLayerChange(){
  const layer = els.layer.value;

  // mostrar/esconder filtros
  const geoOn = (layer === "uf" || layer === "mun");
  $("geoFilters").style.display = geoOn ? "block" : "none";

  const profOn = (layer === "sexo" || layer === "raca" || layer === "esc");
  $("profileFilters").style.display = profOn ? "block" : "none";

  // habilitar UF/MUN conforme camada
  if (layer === "uf"){
    els.uf.disabled = false;
    els.mun.disabled = true;
  } else if (layer === "mun"){
    els.uf.disabled = false;
    els.mun.disabled = false;
  }

  // preencher filtros de perfil
  if (profOn){
    const prof = DB.perfil[layer].cats;
    fillSelect(els.cat, prof, "Selecione…");
    els.cat.value = prof[0] || "";
  }

  // municípios dependem da UF numérica (2 dígitos)
  if (layer === "mun"){
    // para facilitar: UF aqui será "11","12"... (numérica)
    // vamos repovoar o select de UF com as numéricas (DB.munAno.ufs)
    fillSelect(els.uf, DB.munAno.ufs, "UF (numérica) …");
  } else if (layer === "uf"){
    fillSelect(els.uf, DB.ufAno.ufs, "Selecione…");
  }

  // limpar município
  els.mun.innerHTML = "";
  fillSelect(els.mun, [], "Selecione…");

  setupQuestions(layer);
}

els.layer.addEventListener("change", ()=>{
  onLayerChange();
  setStatus("Camada alterada. Clique em Responder.");
});

els.uf.addEventListener("change", ()=>{
  if (els.layer.value !== "mun") return;
  const ufNum = els.uf.value;
  const munList = uniq(DB.munAno.out.filter(d=>d.uf===ufNum).map(d=>d.municipio)).sort();
  fillSelect(els.mun, munList, "Selecione…");
});

els.btnReload.addEventListener("click", async ()=>{
  try{
    await loadAll();
  }catch(e){
    console.error(e);
    setStatus("Erro ao recarregar. Confira nomes/arquivos em /data.");
  }
});

els.btnExportView.addEventListener("click", ()=>{
  downloadCSVFromTable(`painel_dengue_visao_${els.layer.value}_${Date.now()}.csv`);
});

// ===== Core analytics per layer =====
function getYearRange(){
  const y0 = Number(els.y0.value);
  const y1 = Number(els.y1.value);
  const [a,b] = clampYearRange(y0,y1);
  return { y0:a, y1:b };
}

function answerAndRender(){
  const layer = els.layer.value;
  const q = els.question.value;
  const {y0,y1} = getYearRange();

  if (layer === "br"){
    const rows = DB.brMensal.filter(r=>r.ano>=y0 && r.ano<=y1);
    const years = rows.map(r=>r.ano);
    const values = rows.map(r=>r.total);

    const t = linearTrend(years, values);
    setKPIs(values, t);

    // perguntas
    if (q === "trend_total"){
      const bullets = [
        `Período: <b>${y0}–${y1}</b>`,
        `Tendência: <b>${t.label}</b> (inclinação ≈ <b>${fmt(t.slope)}</b> casos/ano; R² ${t.r2.toFixed(2).replace(".",",")})`,
        `Mudança no período: <b>${pct(t.pctChange)}</b>`,
      ];
      els.answer.innerHTML = buildAnswerBlock(
        "Brasil: tendência dos casos (2014+)",
        bullets,
        "Interpretação prática: se a tendência é crescente, a vigilância deve antecipar pico sazonal, reforçar atenção primária e ações de controle vetorial antes dos meses críticos."
      );
    }

    if (q === "peak_year"){
      const maxV = Math.max(...values);
      const minV = Math.min(...values);
      const yMax = years[values.indexOf(maxV)];
      const yMin = years[values.indexOf(minV)];
      els.answer.innerHTML = buildAnswerBlock(
        "Brasil: anos com maior e menor número de casos",
        [
          `Maior ano: <b>${yMax}</b> com <b>${fmt(maxV)}</b> casos.`,
          `Menor ano: <b>${yMin}</b> com <b>${fmt(minV)}</b> casos.`,
          `Média anual no período: <b>${fmt(values.reduce((a,b)=>a+b,0)/values.length)}</b>.`,
        ],
        "Use isso para contextualizar 2024/2025 e definir metas realistas de redução."
      );
    }

    if (q === "peak_month"){
      // soma meses no período selecionado
      const sum = {};
      MONTHS.forEach(m=>sum[m]=0);
      rows.forEach(r=>{
        MONTHS.forEach(m=>sum[m]+=r.meses[m]||0);
      });
      const entries = MONTHS.map(m=>({mes:m, casos:sum[m]})).sort((a,b)=>b.casos-a.casos);
      const top = entries[0], low = entries[entries.length-1];

      els.answer.innerHTML = buildAnswerBlock(
        "Brasil: sazonalidade (meses com mais/menos casos)",
        [
          `Mês com mais casos (somado em ${y0}–${y1}): <b>${top.mes}</b> (<b>${fmt(top.casos)}</b>).`,
          `Mês com menos casos: <b>${low.mes}</b> (<b>${fmt(low.casos)}</b>).`,
          `Recomendação: iniciar ações de prevenção e controle <b>1–2 meses antes</b> do pico.`,
        ],
        "Observação: este cálculo usa 'mês do 1º sintoma' na base Brasil."
      );

      // gráfico: barras por mês
      renderChart("bar", MONTHS, [{
        label:`Brasil — casos por mês (somado ${y0}–${y1})`,
        data: MONTHS.map(m=>sum[m]),
      }], "Sazonalidade");
      renderTable(["Mês","Casos"], MONTHS.map(m=>({ "Mês": m, "Casos": fmt(sum[m]) })));
      return;
    }

    // gráfico padrão: linha anual
    renderChart("line", years, [{
      label:`Brasil — total anual (${y0}–${y1})`,
      data: values,
      tension:0.25,
      pointRadius:3,
      pointHoverRadius:6
    }], "Total anual");
    renderTable(["Ano","Casos"], years.map((yy,i)=>({ "Ano": yy, "Casos": fmt(values[i]) })));
    return;
  }

  if (layer === "uf"){
    const ufName = els.uf.value;
    if (!ufName){ setStatus("Selecione uma UF."); return; }

    const rows = DB.ufAno.out.filter(d=>d.uf===ufName && d.ano>=y0 && d.ano<=y1);
    const years = uniq(rows.map(r=>r.ano)).sort((a,b)=>a-b);
    const values = years.map(y=> rows.filter(r=>r.ano===y).reduce((a,b)=>a+b.casos,0));

    const t = linearTrend(years, values);
    setKPIs(values, t);

    if (q === "trend_geo"){
      els.answer.innerHTML = buildAnswerBlock(
        `UF: ${ufName} — tendência`,
        [
          `Período: <b>${y0}–${y1}</b>`,
          `Tendência: <b>${t.label}</b> (≈ <b>${fmt(t.slope)}</b> casos/ano; R² ${t.r2.toFixed(2).replace(".",",")})`,
          `Mudança no período: <b>${pct(t.pctChange)}</b>`
        ],
        "Sugestão de política pública: cruzar esta tendência com ações de prevenção e capacidade de atendimento (APS/UPA), ajustando orçamento antes do pico."
      );
    }

    if (q === "top_geo"){
      // top UFs no período
      const all = DB.ufAno.out.filter(d=>d.ano>=y0 && d.ano<=y1);
      const map = new Map();
      all.forEach(d=> map.set(d.uf, (map.get(d.uf)||0) + d.casos));
      const top = [...map.entries()].map(([uf,casos])=>({uf,casos})).sort((a,b)=>b.casos-a.casos).slice(0,15);

      els.answer.innerHTML = buildAnswerBlock(
        `Ranking de UFs (total no período ${y0}–${y1})`,
        [
          `Top 1: <b>${top[0].uf}</b> com <b>${fmt(top[0].casos)}</b> casos.`,
          `Esse ranking ajuda a comparar pressão epidemiológica entre UFs.`,
        ],
        "Atenção: ranking não é taxa. Para incidência (por 100 mil), precisamos adicionar população do IBGE."
      );

      renderChart("bar", top.map(d=>d.uf), [{
        label:`UFs — total (${y0}–${y1})`,
        data: top.map(d=>d.casos)
      }], "Top UFs");
      renderTable(["UF","Casos"], top.map(d=>({ "UF": d.uf, "Casos": fmt(d.casos) })));
      return;
    }

    renderChart("line", years, [{
      label:`${ufName} — casos por ano`,
      data: values,
      tension:0.25,
      pointRadius:3,
      pointHoverRadius:6
    }], "Série anual");
    renderTable(["Ano","Casos"], years.map((yy,i)=>({ "Ano": yy, "Casos": fmt(values[i]) })));
    return;
  }

  if (layer === "mun"){
    const ufNum = els.uf.value;
    const mun = els.mun.value;
    if (!ufNum){ setStatus("Selecione a UF (numérica)."); return; }
    if (!mun){ setStatus("Selecione o município."); return; }

    const rows = DB.munAno.out.filter(d=>d.uf===ufNum && d.municipio===mun && d.ano>=y0 && d.ano<=y1);
    const years = uniq(rows.map(r=>r.ano)).sort((a,b)=>a-b);
    const values = years.map(y=> rows.filter(r=>r.ano===y).reduce((a,b)=>a+b.casos,0));

    const t = linearTrend(years, values);
    setKPIs(values, t);

    if (q === "trend_geo"){
      els.answer.innerHTML = buildAnswerBlock(
        `Município: ${mun} — tendência`,
        [
          `Período: <b>${y0}–${y1}</b>`,
          `Tendência: <b>${t.label}</b> (≈ <b>${fmt(t.slope)}</b> casos/ano; R² ${t.r2.toFixed(2).replace(".",",")})`,
          `Mudança no período: <b>${pct(t.pctChange)}</b>`
        ],
        "Sugestão local: se crescente, priorize bairros/áreas críticas (LIRAa/ovitrampas), manejo de resíduos, água parada e comunicação comunitária antes do pico."
      );
    }

    if (q === "top_geo"){
      // top municípios (por UF numérica selecionada) no período
      const all = DB.munAno.out.filter(d=>d.uf===ufNum && d.ano>=y0 && d.ano<=y1);
      const map = new Map();
      all.forEach(d=> map.set(d.municipio, (map.get(d.municipio)||0) + d.casos));
      const top = [...map.entries()].map(([municipio,casos])=>({municipio,casos}))
        .sort((a,b)=>b.casos-a.casos).slice(0,15);

      els.answer.innerHTML = buildAnswerBlock(
        `Ranking de municípios (UF ${ufNum}) — ${y0}–${y1}`,
        [
          `Top 1: <b>${top[0].municipio}</b> com <b>${fmt(top[0].casos)}</b> casos.`,
          `Use este ranking para priorizar vigilância e resposta em áreas com maior carga.`,
        ],
        "Atenção: isto é total absoluto (não taxa). Para incidência, precisamos população."
      );

      renderChart("bar", top.map(d=>d.municipio), [{
        label:`Municípios — total (${y0}–${y1})`,
        data: top.map(d=>d.casos)
      }], "Top municípios");
      renderTable(["Município","Casos"], top.map(d=>({ "Município": d.municipio, "Casos": fmt(d.casos) })));
      return;
    }

    renderChart("line", years, [{
      label:`${mun} — casos por ano`,
      data: values,
      tension:0.25,
      pointRadius:3,
      pointHoverRadius:6
    }], "Série anual");
    renderTable(["Ano","Casos"], years.map((yy,i)=>({ "Ano": yy, "Casos": fmt(values[i]) })));
    return;
  }

  if (layer === "sexo" || layer === "raca" || layer === "esc"){
    const cat = els.cat.value;
    if (!cat){ setStatus("Selecione uma categoria."); return; }

    const prof = DB.perfil[layer];
    const rows = prof.out.filter(d=>d.ano>=y0 && d.ano<=y1);

    // série da categoria selecionada
    const years = uniq(rows.map(d=>d.ano)).sort((a,b)=>a-b);
    const valuesCat = years.map(y => rows.filter(d=>d.ano===y && d.cat===cat).reduce((a,b)=>a+b.casos,0));
    const tCat = linearTrend(years, valuesCat);
    setKPIs(valuesCat, tCat);

    if (q === "trend_cat"){
      const maxV = Math.max(...valuesCat), minV = Math.min(...valuesCat);
      const yMax = years[valuesCat.indexOf(maxV)];
      const yMin = years[valuesCat.indexOf(minV)];

      const titleMap = {sexo:"Sexo", raca:"Raça/Cor", esc:"Escolaridade"};
      const what = titleMap[layer];

      els.answer.innerHTML = buildAnswerBlock(
        `${what}: ${cat} — tendência e resumo`,
        [
          `Período: <b>${y0}–${y1}</b>`,
          `Tendência: <b>${tCat.label}</b> (≈ <b>${fmt(tCat.slope)}</b> casos/ano; R² ${tCat.r2.toFixed(2).replace(".",",")})`,
          `Mudança no período: <b>${pct(tCat.pctChange)}</b>`,
          `Maior ano: <b>${yMax}</b> (${fmt(maxV)}). Menor ano: <b>${yMin}</b> (${fmt(minV)}).`
        ],
        `Resposta prática: "Os casos de dengue em <b>${cat}</b> ${tCat.label === "crescente" ? "têm aumentado" : tCat.label === "decrescente" ? "têm diminuído" : "estão relativamente estáveis"} no período analisado".`
      );
    }

    if (q === "top_cat"){
      // total por categoria no período
      const map = new Map();
      rows.forEach(d=>{
        map.set(d.cat, (map.get(d.cat)||0) + d.casos);
      });
      const ranking = [...map.entries()].map(([cat,casos])=>({cat,casos})).sort((a,b)=>b.casos-a.casos);
      const top = ranking[0];

      els.answer.innerHTML = buildAnswerBlock(
        "Categoria com maior concentração de casos (no período)",
        [
          `Top: <b>${top.cat}</b> com <b>${fmt(top.casos)}</b> casos no período ${y0}–${y1}.`,
          `Isso ajuda a direcionar comunicação, cuidado e vigilância para o grupo mais afetado.`,
        ],
        "Atenção: concentração não é risco individual; é carga observada na notificação."
      );

      renderChart("bar", ranking.slice(0,12).map(d=>d.cat), [{
        label:`Total por categoria (${y0}–${y1})`,
        data: ranking.slice(0,12).map(d=>d.casos)
      }], "Distribuição por categoria");
      renderTable(["Categoria","Casos"], ranking.map(d=>({ "Categoria": d.cat, "Casos": fmt(d.casos) })));
      return;
    }

    if (q === "compare_all"){
      // comparação (tendência e % mudança) para todas categorias
      const cats = prof.cats;
      const summary = cats.map(c=>{
        const vals = years.map(y => rows.filter(d=>d.ano===y && d.cat===c).reduce((a,b)=>a+b.casos,0));
        const t = linearTrend(years, vals);
        const total = vals.reduce((a,b)=>a+b,0);
        return { cat:c, total, slope:t.slope, r2:t.r2, label:t.label, pctChange:t.pctChange };
      }).sort((a,b)=>b.total-a.total);

      els.answer.innerHTML = buildAnswerBlock(
        "Comparação entre categorias (no período)",
        [
          `Maior carga total: <b>${summary[0].cat}</b> (${fmt(summary[0].total)}).`,
          `Maior tendência crescente (slope): <b>${summary.slice().sort((a,b)=>b.slope-a.slope)[0].cat}</b>.`,
          `Maior tendência decrescente (slope): <b>${summary.slice().sort((a,b)=>a.slope-b.slope)[0].cat}</b>.`,
        ],
        "Use isso para identificar onde a curva está acelerando e reforçar ações preventivas e de assistência."
      );

      // gráfico: barras por total
      renderChart("bar", summary.slice(0,12).map(d=>d.cat), [{
        label:`Total por categoria (${y0}–${y1})`,
        data: summary.slice(0,12).map(d=>d.total)
      }], "Comparação (total)");

      renderTable(
        ["Categoria","Total","Tendência","Slope (casos/ano)","% mudança","R²"],
        summary.map(d=>({
          "Categoria": d.cat,
          "Total": fmt(d.total),
          "Tendência": d.label,
          "Slope (casos/ano)": fmt(d.slope),
          "% mudança": pct(d.pctChange),
          "R²": d.r2.toFixed(2).replace(".",",")
        }))
      );
      return;
    }

    // padrão: linha da categoria selecionada
    renderChart("line", years, [{
      label:`${cat} — casos por ano`,
      data: valuesCat,
      tension:0.25,
      pointRadius:3,
      pointHoverRadius:6
    }], "Série anual (categoria)");
    renderTable(["Ano","Casos"], years.map((yy,i)=>({ "Ano": yy, "Casos": fmt(valuesCat[i]) })));
    return;
  }

  if (layer === "faixa"){
    // Não tem ano aqui; é agregado do período (2014-2025) por faixa etária x mês
    const rows = DB.faixaMes.out;

    if (q === "top_age"){
      const map = new Map();
      rows.forEach(d=> map.set(d.faixa, (map.get(d.faixa)||0)+d.casos));
      const ranking = [...map.entries()].map(([faixa,casos])=>({faixa,casos})).sort((a,b)=>b.casos-a.casos);

      setKPIs(ranking.map(d=>d.casos), {label:"—", slope:0, r2:0, pctChange:0});
      els.kpiTrend.textContent = "—";

      els.answer.innerHTML = buildAnswerBlock(
        "Faixa etária: quem concentra mais casos (total agregado)",
        [
          `Top: <b>${ranking[0].faixa}</b> com <b>${fmt(ranking[0].casos)}</b> casos.`,
          `Isto ajuda a priorizar orientações e estratégias de assistência.`,
        ],
        "Observação: esta tabela não separa por ano (é uma soma do período disponível na extração)."
      );

      renderChart("bar", ranking.slice(0,12).map(d=>d.faixa), [{
        label:"Total por faixa etária (agregado)",
        data: ranking.slice(0,12).map(d=>d.casos)
      }], "Total por faixa etária");
      renderTable(["Faixa etária","Casos"], ranking.map(d=>({ "Faixa etária": d.faixa, "Casos": fmt(d.casos) })));
      return;
    }

    if (q === "peak_month_by_age"){
      // pico/vale por faixa
      const faixas = DB.faixaMes.faixas;
      const summary = faixas.map(f=>{
        const byM = MONTHS.map(m=>{
          const v = rows.filter(d=>d.faixa===f && d.mes===m).reduce((a,b)=>a+b.casos,0);
          return {m, v};
        });
        byM.sort((a,b)=>b.v-a.v);
        return { faixa:f, mesMax:byM[0].m, max:byM[0].v, mesMin:byM[byM.length-1].m, min:byM[byM.length-1].v, total: byM.reduce((a,b)=>a+b.v,0) };
      }).sort((a,b)=>b.total-a.total);

      setKPIs(summary.map(d=>d.total), {label:"—", slope:0, r2:0, pctChange:0});
      els.kpiTrend.textContent = "—";

      els.answer.innerHTML = buildAnswerBlock(
        "Faixa etária: meses com maior e menor ocorrência",
        [
          `Exemplo (faixa com maior carga): <b>${summary[0].faixa}</b> — pico em <b>${summary[0].mesMax}</b> (${fmt(summary[0].max)}) e menor em <b>${summary[0].mesMin}</b> (${fmt(summary[0].min)}).`,
          `A sazonalidade pode guiar a antecipação da rede de atendimento e comunicação.`,
        ],
        "Observação: agregado do período na extração atual."
      );

      // gráfico: mostrar top 6 faixas por total, com pico mensal (só como visão rápida)
      const top6 = summary.slice(0,6);
      renderChart("bar", top6.map(d=>d.faixa), [{
        label:"Total por faixa (top 6)",
        data: top6.map(d=>d.total)
      }], "Top faixas (agregado)");

      renderTable(
        ["Faixa etária","Total","Mês pico","Casos (pico)","Mês menor","Casos (menor)"],
        summary.map(d=>({
          "Faixa etária": d.faixa,
          "Total": fmt(d.total),
          "Mês pico": d.mesMax,
          "Casos (pico)": fmt(d.max),
          "Mês menor": d.mesMin,
          "Casos (menor)": fmt(d.min),
        }))
      );
      return;
    }
  }

  setStatus("Camada/pergunta não suportada.");
}

// ===== Events =====
els.btnRun.addEventListener("click", ()=>{
  try{
    setStatus("Analisando…");
    answerAndRender();
    setStatus("Pronto.");
  }catch(e){
    console.error(e);
    setStatus("Erro ao analisar. Veja o console (F12).");
  }
});

// Start
(async ()=>{
  try{
    await loadAll();
  }catch(e){
    console.error(e);
    setStatus("Erro ao carregar dados. Confira arquivos em /data e nomes.");
  }
})();

