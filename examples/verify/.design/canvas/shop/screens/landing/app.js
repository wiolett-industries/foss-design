fetch('./data.json').then((r) => r.json()).then((d) => { document.getElementById('data').textContent = d.message })
