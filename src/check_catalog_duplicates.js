async function auditCatalog() {
    const supabaseUrl = 'https://tioqayfuqigkrakxlecx.supabase.co'
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpb3FheWZ1cWlna3Jha3hsZWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTE5NDksImV4cCI6MjEwMTcyNzk0OX0.HD_36_xe7Ms7_K0hefJ_H3vKx1SPnmvMeML55kcINUI'

    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/presentaciones?select=*,productos(*)`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        })

        const presentaciones = await res.json()

        console.log("==================================================")
        console.log(`📦 PRESENTACIONES EN CATÁLOGO (${presentaciones.length} REGISTROS):`)
        console.log("==================================================")

        presentaciones.forEach(p => {
            console.log(`- Pres ID: ${p.id} | Pres: "${p.nombre_presentacion}" (x${p.factor_conversion}) | Prod: "${p.productos?.nombre}" (ID: ${p.producto_id}) | Stock Base: ${p.productos?.stock_base} ${p.productos?.unidad_base}`)
        })

        console.log("==================================================")
    } catch (err) {
        console.error("Error al auditar catálogo:", err)
    }
}

auditCatalog()
