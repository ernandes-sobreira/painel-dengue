const DATA = {
  br:"data/dados-dengue.csv",
  uf:"data/dados-dengue-estados.csv",
  mun:"data/dados-dengue-municipios.csv",
  sexo:"data/dados-dengue-sexo.csv",
  raca:"data/dados-dengue-raca.csv",
  esc:"data/dados-dengue-escolaridade.csv"
};

const START = 2014;
let DB = {}, chart;

const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat("pt-BR").format(n);

async function loadCSV(url){
  const t = await fetch(url).then(r=>r.text());
  return Papa.parse(t,{header:true,skipEmptyLines:true}).data;
}

function linReg(x,y){
  const n=x.length, mx=x.reduce((a,b)=>a+b)/n, my=y.reduce((a,b)=>a+b)/n;
  let num=0,den=0;
  for(let i=0;i<n;i++){ num+=(x[i]-mx)*(y[i]-my); den+=(x[i]-mx)**2; }
  const slope=num/den, intercept=my-slope*mx;
  return {slope,intercept};
}

function setupYears(){
  for(let y=START;y<=2025;y++){
    $("y0").add(new Option(y,y));
    $("y1").add(new Option(y,y));
  }
  $("y0").value=START;
  $("y1").value=2025;
}

async function init(){
  for(const k in DATA) DB[k]=await loadCSV(DATA[k]);

  ["br","uf","mun","sexo","raca","esc"].forEach(v=>{
    $("layer").add(new Option(v,v));
  });

  setupYears();
}

function run(){
  const layer=$("layer").value;
  let rows=DB[layer];

  const y0=+$("y0").value, y1=+$("y1").value;
  rows=rows.filter(r=>+r.Ano>=y0 && +r.Ano<=y1);

  const years=rows.map(r=>+r.Ano);
  const vals=rows.map(r=>+r.Casos);

  $("kTotal").textContent=fmt(vals.reduce((a,b)=>a+b,0));
  $("kMean").textContent=fmt(vals.reduce((a,b)=>a+b,0)/vals.length);
  $("kPeak").textContent=Math.max(...vals);

  if(chart) chart.destroy();

  const datasets=[{
    label:"Casos",
    data:vals,
    borderColor:"#2563eb",
    tension:0.3
  }];

  if($("advanced").checked){
    const lr=linReg(years,vals);
    datasets.push({
      label:"Tendência",
      data:years.map(y=>lr.intercept+lr.slope*y),
      borderDash:[5,5],
      borderColor:"#ec4899"
    });
    $("advBox").style.display="block";
    $("kTrend").textContent=lr.slope>0?"Crescente":"Decrescente";
  } else {
    $("advBox").style.display="none";
  }

  chart=new Chart($("chart"),{
    type:"line",
    data:{labels:years,datasets},
    options:{plugins:{zoom:{zoom:{wheel:{enabled:true},mode:"x"}}}}
  });

  $("table").innerHTML="<tr><th>Ano</th><th>Casos</th></tr>"+
    years.map((y,i)=>`<tr><td>${y}</td><td>${fmt(vals[i])}</td></tr>`).join("");
}

$("run").onclick=run;
$("export").onclick=()=>alert("Exportação mantida como antes");

init();
