// app.js - backend + UI wiring
(async function(){
  const data = await fetch('data.json').then(r => r.json());

  // UI elements
  const systemEl = document.getElementById('system');
  const ageEl = document.getElementById('age');
  const insectEl = document.getElementById('insecticide');
  const methodEl = document.getElementById('method');
  const areaEl = document.getElementById('area');
  const calcBtn = document.getElementById('calcBtn');
  const resetBtn = document.getElementById('resetBtn');
  const toggleBreakdownBtn = document.getElementById('toggleBreakdownBtn');

  const materialVal = document.getElementById('materialVal');
  const applicationVal = document.getElementById('applicationVal');
  const totalVal = document.getElementById('totalVal');
  const breakdownBox = document.getElementById('breakdownBox');

  // populate orchard systems
  const systemLabels = {
  traditional: "Traditional Orchard",
  high: "High Density Orchard",
  medium: "Medium Density Orchard"
};

const systems = Object.keys(data.sprayVolume);
systems.forEach(s => {
  const opt = document.createElement('option');
  opt.value = s;
  opt.textContent = systemLabels[s] || s;
  systemEl.appendChild(opt);
});

  function populateAges(){
    ageEl.innerHTML = '';
    const ages = Object.keys(data.sprayVolume[systemEl.value]);
    ages.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      ageEl.appendChild(opt);
    });
  }

  // populate insecticides
  Object.keys(data.costPer100L).forEach(k => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = k;
    insectEl.appendChild(o);
  });

  populateAges();
  systemEl.addEventListener('change', populateAges);

  function getRVF(ageYears){
    const idx = Math.min(10, Math.max(1, Math.floor(ageYears)));
    return data.rvf[String(idx)] ?? 0.4;
  }

  function computeMaterialCost(insecticide, system, age){
    const cost100 = Number(data.costPer100L[insecticide]);
    const volume = Number(data.sprayVolume[system][age]);
    const material = cost100 * (volume / 100);
    return {material, cost100, volume};
  }

  function computeFixedPerHour(method){
    const m = data.defaults.machine;
    const econ = data.defaults.economic;
    const H = Number(m.annualHours);
    const L = Number(m.expectedLifeYears);
    const C = Number(m.purchasePrice);
    let salvage;
    if (method === 'ASA'){
      salvage = Number(m.currentListPrice) * getRVF(Number(m.machineAgeYears));
    } else {
      salvage = 0.10 * C;
    }
    const totalDep = C - salvage;
    const annualDep = totalDep / L;
    const dep_per_hr = annualDep / H;
    const avgInvestment = (C + salvage) / 2;
    const interest_per_hr = (avgInvestment * Number(econ.realInterestRate)) / H;
    const tih_per_hr = (avgInvestment * Number(econ.TIH_rate)) / H;
    return {
      dep_per_hr, interest_per_hr, tih_per_hr,
      fixed_per_hr: dep_per_hr + interest_per_hr + tih_per_hr
    };
  }

  function computeVariablePerHour(){
    const m = data.defaults.machine;
    const op = data.defaults.operational;
    const H = Number(m.annualHours);
    const C = Number(m.purchasePrice);
    const repairs_per_hr = (Number(op.repair_pct_per_year) * C) / H;
    const fuel_per_hr = Number(op.fuel_l_per_hr) * Number(op.fuel_price_per_L);
    const lube_per_hr = Number(op.lubrication_pct) * fuel_per_hr;
    const labour_per_hr = (Number(op.numLabourUnits) * Number(op.wage_per_day)) / Number(op.workday_hours);
    const variable = repairs_per_hr + fuel_per_hr + lube_per_hr + labour_per_hr;
    return {repairs_per_hr, fuel_per_hr, lube_per_hr, labour_per_hr, variable_per_hr: variable};
  }

  function computeHoursPerKanal(volume){
    const hb = data.defaults.hours_bucket;
    if (volume <= hb.typeI_max_L) return hb.typeI_hours_per_kanal;
    return hb.typeII_hours_per_kanal;
  }

  function computeForMethod(system, age, insecticide, method){
    const mat = computeMaterialCost(insecticide, system, age);
    const fixed = computeFixedPerHour(method);
    const variable = computeVariablePerHour();
    const total_hourly = fixed.fixed_per_hr + variable.variable_per_hr;
    const hours_per_kanal = computeHoursPerKanal(mat.volume);
    const application_per_kanal = total_hourly * hours_per_kanal;
    const total_per_kanal = mat.material + application_per_kanal;
    return {material: mat.material, material_details: mat, fixed, variable,
            total_hourly, hours_per_kanal, application_per_kanal, total_per_kanal};
  }

  function displayResults(sys, age, insect, method, area){
    const res = computeForMethod(sys, age, insect, method);
    materialVal.textContent = res.material.toFixed(2);
    applicationVal.textContent = res.application_per_kanal.toFixed(2);
    totalVal.textContent = res.total_per_kanal.toFixed(2);

    breakdownBox.innerHTML = `
      <div><strong>Breakdown (${method} method)</strong></div>
      <div class="muted" style="margin-top:6px">
        Spray volume (L/kanal): ${res.material_details.volume}<br/>
        Material cost per 100L: Rs ${res.material_details.cost100}<br/><br/>
        <strong>Fixed costs (per hr)</strong><br/>
        Depreciation: Rs ${res.fixed.dep_per_hr.toFixed(2)}<br/>
        Interest: Rs ${res.fixed.interest_per_hr.toFixed(2)}<br/>
        TIH: Rs ${res.fixed.tih_per_hr.toFixed(2)}<br/><br/>
        <strong>Variable costs (per hr)</strong><br/>
        Repairs: Rs ${res.variable.repairs_per_hr.toFixed(2)}<br/>
        Fuel: Rs ${res.variable.fuel_per_hr.toFixed(2)}<br/>
        Lubrication: Rs ${res.variable.lube_per_hr.toFixed(2)}<br/>
        Labour: Rs ${res.variable.labour_per_hr.toFixed(2)}<br/><br/>
        Total hourly cost: Rs ${res.total_hourly.toFixed(2)}<br/>
        Hours per kanal: ${res.hours_per_kanal}<br/>
        Application cost/kanal: Rs ${res.application_per_kanal.toFixed(2)}<br/>
        Total cost/kanal: Rs ${res.total_per_kanal.toFixed(2)}<br/>
        For ${area} kanal: Rs ${(res.total_per_kanal * area).toFixed(2)}
      </div>`;
  }

  calcBtn.addEventListener('click', () => {
    displayResults(systemEl.value, ageEl.value, insectEl.value, methodEl.value, Number(areaEl.value) || 1);
  });

  resetBtn.addEventListener('click', () => {
    systemEl.selectedIndex = 0; populateAges();
    insectEl.selectedIndex = 0; methodEl.selectedIndex = 0;
    areaEl.value = '1';
    materialVal.textContent = '—'; applicationVal.textContent = '—'; totalVal.textContent = '—';
    breakdownBox.innerHTML = ''; breakdownBox.style.display='none';
  });

  toggleBreakdownBtn.addEventListener('click', () => {
    breakdownBox.style.display = breakdownBox.style.display === 'none' ? 'block' : 'none';
  });

  calcBtn.click();
})();
