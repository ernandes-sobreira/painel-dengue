/* =========================================================
   Painel Dengue — BÁSICO FUNCIONAL (TABNET REAL)
   Estados e Municípios com nome
   ========================================================= */

const FILE = "assets/data/dados-dengue-municipios.csv";

const UF_IBGE = {
  "11":"RO","12":"AC","13":"AM","14":"RR","15":"PA","16":"AP","17":"TO",
  "21":"MA","22":"PI","23":"CE","24":"RN","25":"PB","26":"PE","27":"AL","28":"SE","29":"BA",
  "31":"MG","32":"ES","33":"RJ","35":"SP",
  "41":"PR","42":"SC","43":"RS",
  "50":"MS","51":"MT","52":"GO","53":"DF"
};

let DATA = [];
let YEARS = [];
let chart;

const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat("pt-BR").format(n || 0);

async function loadData(){
  const res = await fetch(FILE + `?v=${Date.now()}`);
  const text = await res.text();

  const lines = text.split(/\r?\n/);

  // 👉 pula as 4 primeiras linhas (texto do TABNET)
  const headerLine = lines[4];
  const dataLines  = lines.slice(5);

  const headers = headerLine.split(";").map(h => h.replace(/"/g,"").trim());

  YEARS = headers
    .filter(h => /^\d{4}$/.test(h))
    .map(Number);

  DATA = [];

  for(const line of dataLines){
    if(!line.trim()) continue;

    const cols = line.split(";").map(c => c.replace(/"/g,"").trim());

    const rawName = cols[0];
    if(rawName.toLowerCase().includes("ignorado")) continue;

    // "110001 ALTA FLORESTA D'OESTE"
    const parts = rawName.split(" ");
    const ibge6 = parts[0];
    const uf = UF_IBGE[ibge6.slice(0,2)];
    const municipio = parts.slice(1).join(" ");

    const values = {};
    YEARS.forEach((y, i) => {
      const v = cols[headers.indexOf(String(y))];
      values[y] = v === "-" ? 0 : Number(v);
    });

    DATA.push({ uf, municipio, values });
  }

  setupUI();
}

function setupUI(){
  // UFs
  const ufs = [...new Set(DATA.map(d => d.uf))].sort();
  $("uf").innerHTML = `<option value="">Selecione a UF</option>`;
  ufs.forEach(u => $("uf").add(new Option(u, u)));

  $("uf").onchange = () => {
    const uf = $("uf").value;
    const muns = DATA.filter(d => d.uf === uf).map(d => d.municipio).sort();
    $("mun").innerHTML = `<option value="">Selecione o município</option>`;
    muns.forEach(m => $("mun").add(new Option(m, m)));
  };

  // anos
  $("y0").innerHTML = "";
  $("y1").innerHTML = "";
  YEARS.forEach(y => {
    $("y0").add(new Option(y,y));
    $("y1").add(new Option(y,y));
  });
  $("y0").value = YEARS[0];
  $("y1").value = YEARS[YEARS.length-1];
}

function run(){
  const uf = $("uf").value;
  const mun = $("mun").value;
  const y0 = +$("y0").value;
  const y1 = +$("y1").value;

  if(!uf || !mun){
    alert("Selecione UF e Município");
    return;
  }

  const row = DATA.find(d => d.uf === uf && d.municipio === mun);
  if(!row) return;

  const anos = YEARS.filter(y => y >= y0 && y <= y1);
  const vals = anos.map(y => row.values[y] || 0);

  $("kTotal").textContent = fmt(vals.reduce((a,b)=>a+b,0));
  $("kMean").textContent  = fmt(vals.reduce((a,b)=>a+b,0)/vals.length);
  $("kPeak").textContent  = fmt(Math.max(...vals));

  if(chart) chart.destroy();
  chart = new Chart($("chart"),{
    type:"line",
    data:{
      labels: anos,
      datasets:[{
        label:`Casos de dengue — ${mun} (${uf})`,
        data: vals,
        borderColor:"#ec4899",
        backgroundColor:"rgba(236,72,153,0.2)",
        tension:0.3
      }]
    }
  });

  $("table").innerHTML =
    "<tr><th>Ano</th><th>Casos</th></tr>" +
    anos.map((y,i)=>`<tr><td>${y}</td><td>${fmt(vals[i])}</td></tr>`).join("");
}

$("run").onclick = run;

loadData();
