(async()=>{
  const body={userId:'cmjr6yztf0000gspw8il1tf72', day:'2026-01-14', slot1:'TEST-From-Home-20260116-1'};
  try{
    const r=await fetch('http://localhost:3000/api/schedule/cell/set',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const t=await r.text();
    console.log('status',r.status);
    console.log(t);
  }catch(e){console.error(e)}
})();
