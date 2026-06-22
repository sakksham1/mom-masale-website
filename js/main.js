
async function loadProducts(){
 const c=document.getElementById('products-container');
 if(!c) return;
 const data=await fetch('data/products.json').then(r=>r.json());
 c.innerHTML=data.map(p=>`
 <div class="card">
 <img src="${p.image}" alt="${p.name}">
 <h3>${p.name}</h3>
 <p>${p.category}</p>
 <p>Sizes: ${p.sizes.join(', ')}</p>
 <a class="btn" href="${p.amazon}">Buy on Amazon</a>
 </div>`).join('');
}
loadProducts();
