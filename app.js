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

  const materialVal = document.getElementById('materialVal');
  const applicationVal = document.getElementById('applicationVal');
  const totalVal = document.getElementById('totalVal');
  const breakdownBox = document.getElementById('breakdownBox');
  const disclaimerEl = document.getElementById('disclaimer');

  // populate orchard systems
  const systems = Object.keys(data.sprayVolume);
  systems.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
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

  // initial population
  populateAges();
  systemEl.addEventListener('change', populateAges);

  // Utility: get RVF for machine age (floor to integer 1..10)
  function getRVF(ageYears){
    const idx = Math.min(10, Math.max(1, Math.floor(ageYears)));
    return data.rvf[String(idx)] ?? 0.4;
  }

  // Material cost per kanal: cost_per_100L * (volume_L / 100)
  function computeMaterialCost(insecticide, system, age){
    const cost100 = Number(data.costPer100L[insecticide]);
    const volume = Number(data.sprayVolume[system][age]);
    const material = cost100 * (volume / 100);
    return {material, cost100, volume};
  }

  // Fixed cost per hour using ASA
  function computeFixedPerHour(method){
    const m = data.defaults.machine;
    const econ = data.defaults.economic;
    const H = Number(m.annualHours);
    const L = Number(m.expectedLifeYears);
    const C = Number(m.purchasePrice);
    let salvage;
    if (method === 'ASA'){
      salvage = Number(m.currentListPrice) * getRVF(Number(m.machineAgeYears));
    } else { // Straight-Line with 10% salvage
      salvage = 0.10 * C;
    }
    const totalDepreciation = C - salvage;
    const annualDep = totalDepreciation / L;
    const dep_per_hr = annualDep / H;
    const avgInvestment = (C + salvage) / 2;
    const interest_per_hr = (avgInvestment * Number(econ.realInterestRate)) / H;
    const tih_per_hr = (avgInvestment * Number(econ.TIH_rate)) / H;
    return {
      salvage, totalDepreciation, dep_per_hr, interest_per_hr, tih_per_hr,
      fixed_per_hr: dep_per_hr + interest_per_hr + tih_per_hr
    };
  }

  // Variable costs per hour
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

  // hours per kanal: use document buckets (Type I / II) unless user wants derivative
  function computeHoursPerKanal(volume){
    const hb = data.defaults.hours_bucket;
    if (volume <= hb.typeI_max_L) return hb.typeI_hours_per_kanal;
    return hb.typeII_hours_per_kanal;
  }

  // compute totals (for chosen method)
  function computeForMethod(system, age, insecticide, method){
    const mat = computeMaterialCost(insecticide, system, age);
    const fixed = computeFixedPerHour(method);
    const variable = computeVariablePerHour();
    const total_hourly = fixed.fixed_per_hr + variable.variable_per_hr;
    const hours_per_kanal = computeHoursPerKanal(mat.volume);
    const application_per_kanal = total_hourly * hours_per_kanal;
    const total_per_kanal = mat.material + application_per_kanal;
    return {
      material: mat.material,
      material_details: mat,
      fixed, variable, total_hourly, hours_per_kanal, application_per_kanal, total_per_kanal
    };
  }

  // Display function
  function displayResults(sys, age, insect, method, area){
    const res = computeForMethod(sys, age, insect, method);
    const mat = res.material;
    const app = res.application_per_kanal;
    const tot = res.total_per_kanal;
    materialVal.textContent = mat.toFixed(2);
    applicationVal.textContent = app.toFixed(2);
    totalVal.textContent = tot.toFixed(2);

    // breakdown
    const fd = res.fixed;
    const vd = res.variable;
    breakdownBox.innerHTML = `
      <div><strong>Breakdown (${method} method)</strong></div>
      <div class="muted" style="margin-top:6px">
        <div>Spray volume (L/kanal): <strong>${res.material_details.volume}</strong></div>
        <div>Material cost per 100L: <strong>Rs ${res.material_details.cost100}</strong></div>
        <div style="margin-top:6px"><strong>Fixed costs (per hr)</strong></div>
        <div>Depreciation per hr: Rs ${fd.dep_per_hr.toFixed(2)}</div>
        <div>Interest per hr: Rs ${fd.interest_per_hr.toFixed(2)}</div>
        <div>TIH per hr: Rs ${fd.tih_per_hr.toFixed(2)}</div>
        <div style="margin-top:6px"><strong>Variable costs (per hr)</strong></div>
        <div>Repairs per hr: Rs ${vd.repairs_per_hr.toFixed(2)}</div>
        <div>Fuel per hr: Rs ${vd.fuel_per_hr.toFixed(2)}</div>
        <div>Lubrication per hr: Rs ${vd.lube_per_hr.toFixed(2)}</div>
        <div>Labour per hr: Rs ${vd.labour_per_hr.toFixed(2)}</div>
        <div style="margin-top:6px"><strong>Total hourly cost:</strong> Rs ${res.total_hourly.toFixed(2)}</div>
        <div>Hours per kanal: ${res.hours_per_kanal}</div>
        <div style="margin-top:6px"><strong>Application cost / kanal:</strong> Rs ${res.application_per_kanal.toFixed(2)}</div>
        <div style="margin-top:6px"><strong>Total cost / kanal (material + application):</strong> Rs ${res.total_per_kanal.toFixed(2)}</div>
        <div style="margin-top:8px"><strong>For ${area} kanal:</strong> Total = Rs ${(res.total_per_kanal * area).toFixed(2)}</div>
      </div>
    `;
  }

  // main calc button
  calcBtn.addEventListener('click', () => {
    const sys = systemEl.value;
    const age = ageEl.value;
    const insect = insectEl.value;
    const method = methodEl.value;
    const area = Math.max(0.001, Number(areaEl.value) || 1);
    // compute using chosen method; also compute alternate for comparison
    displayResults(sys, age, insect, method, area);
  });

  resetBtn.addEventListener('click', () => {
    systemEl.selectedIndex = 0;
    populateAges();
    insectEl.selectedIndex = 0;
    methodEl.selectedIndex = 0;
    areaEl.value = '1';
    materialVal.textContent = '—';
    applicationVal.textContent = '—';
    totalVal.textContent = '—';
    breakdownBox.innerHTML = '';
  });

  // Pre-calc with defaults
  calcBtn.click();

})();
