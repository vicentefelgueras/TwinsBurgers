# Twins Burgers

Sitio de pedidos para retirar de Twins Burgers (Palm Beach, Gold Coast) y panel del local.

| Archivo | Para quién | Qué hace |
| --- | --- | --- |
| `index.html` | Clientes | Menú y pedido para retirar. El pedido se guarda en Supabase y el cliente ve el estado en vivo. |
| `panel.html` | Dueño y cocina | Pedidos en vivo con aviso de sonido y estados (Aceptar → Listo → Retirado). El dueño también ve Ventas y la comisión. Se entra con correo y contraseña. |

## Base de datos (Supabase, proyecto TwinsBurgers)

- `place_order`: crea el pedido y calcula los precios en el servidor, con validación de datos, horario y límite de 5 pedidos por teléfono por hora.
- `order_status`: devuelve el estado de un pedido a quien tiene su id.
- `store_status`: dice si el local está abierto, pausado o fuera de horario.
- `update_store`: cambia el horario y el tiempo de preparación. Solo lo pueden usar administradores.
- Tablas: `menu_items`, `menu_options`, `orders`, `order_items`, `staff`, `settings`. Todas con RLS: el público solo lee el menú y crea pedidos.
- `settings.enforce_hours`: está en `false` mientras se prueba. Al lanzar se activa desde el panel (Local → "Aplicar el horario en el sitio") (lun–mié 15:30–19:00, jue–dom 16:00–20:00, hora de Queensland).
- La clave del código es la clave pública (publishable) de Supabase. Es segura de publicar porque las reglas RLS limitan lo que se puede hacer con ella.

## Pagos con Square (`supabase/functions`)

| Función | Qué hace |
| --- | --- |
| `square-connect` | Crea el link para que el dueño autorice la app (solo administradores). |
| `square-oauth` | Recibe la autorización, guarda el token del dueño y su local. |
| `create-checkout` | Crea el link de pago de Square de un pedido, con la comisión del 3% como `app_fee_money`. |
| `square-webhook` | Recibe el aviso de Square y marca el pedido como pagado. Valida la firma. |

Secretos en Supabase: `SQUARE_ENV` (`sandbox` o `production`), `SQUARE_APP_ID`, `SQUARE_APP_SECRET` y `SQUARE_WEBHOOK_KEY`.

## Fases

- [x] Fase 2: pedidos reales y panel con login
- [x] Fase 3: horario, productos agotados y pausa de pedidos desde el panel (pestaña Local)
- [ ] Fase 4: pago online con Square y comisión del 3% (código listo; falta configurar la app de Square y probar en sandbox)
- [ ] Fase 5: pruebas y lanzamiento
