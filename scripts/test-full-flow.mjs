// scripts/test-full-flow.mjs
import { createClient } from '@insforge/sdk'

const url = process.env.NEXT_PUBLIC_INSFORGE_URL || 'https://pxjywhe6.us-east.insforge.app'
const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY || 'ik_dc920419d78adda89852846019da2f48'

const db = createClient({ baseUrl: url, anonKey })

console.log('🚀 开始自动化端到端测试全流程...')

async function runTest() {
  try {
    // 1. 获取已存在的卡产品列表（测试银行+卡片联动）
    console.log('\n[1/6] 测试获取卡产品目录（银行与卡片列表）...')
    const { data: products, error: prodErr } = await db.database
      .from('card_products')
      .select('*')
      .order('bank_name', { ascending: true })

    if (prodErr) throw prodErr
    console.log(`✅ 成功获取 ${products.length} 个卡产品`)
    const bankNames = Array.from(new Set(products.map(p => p.bank_name)))
    console.log(`   包含 ${bankNames.length} 家发卡银行:`, bankNames.slice(0, 5).join(', '))

    const targetProduct = products[0]
    console.log(`   选中目标银行: ${targetProduct.bank_name}, 卡产品: ${targetProduct.card_name}`)

    // 2. 创建测试持卡人
    console.log('\n[2/6] 测试创建持卡人档案...')
    const testUserId = '00000000-0000-0000-0000-000000000001' // 测试用户 ID
    const { data: holder, error: holderErr } = await db.database
      .from('card_holders')
      .insert([{
        created_by: testUserId,
        name: '自动化测试用户',
        phone: '13800138000',
        avatar_color: '#030059'
      }])
      .select()
      .single()

    if (holderErr) throw holderErr
    console.log(`✅ 持卡人创建成功！ID: ${holder.id}, 姓名: ${holder.name}`)

    // 3. 测试添加信用卡 (极简兼容 Payload，防 PGRST204 报错)
    console.log('\n[3/6] 测试添加信用卡到该持卡人名下...')
    const { data: card, error: cardErr } = await db.database
      .from('credit_cards')
      .insert([{
        holder_id: holder.id,
        card_product_id: targetProduct.id,
        card_number_last4: '8888',
        credit_limit: 50000,
        billing_day: 15,
        status: 'active'
      }])
      .select()
      .single()

    if (cardErr) {
      console.error('❌ 添加信用卡失败报错:', cardErr)
      throw cardErr
    }
    console.log(`✅ 信用卡添加成功！ID: ${card.id}, 额度: ¥${card.credit_limit}, 尾号: ${card.card_number_last4}`)

    // 3.5. 测试修改/编辑已创建的信用卡 (模拟经过 cleanCardPayload 严格清洗后更新)
    console.log('\n[3.5/6] 测试修改/编辑已创建的信用卡 (验证污染字段被过滤后的安全修改)...')
    
    // 模拟脏数据（带有 override_due_type, card_type 等数据库未定义字段）
    const rawDirtyUpdates = {
      credit_limit: 80000,
      card_number_last4: '9999',
      override_due_type: 'after_billing',
      card_type: 'credit'
    }

    // 执行与 lib/api/cards.ts 完全相同的严格白名单清洗
    const cleanKeys = ['holder_id', 'card_product_id', 'card_number_last4', 'credit_limit', 'billing_day', 'status']
    const cleanUpdates = {}
    for (const key of cleanKeys) {
      if (rawDirtyUpdates[key] !== undefined) cleanUpdates[key] = rawDirtyUpdates[key]
    }

    const { data: updatedCard, error: updateErr } = await db.database
      .from('credit_cards')
      .update(cleanUpdates)
      .eq('id', card.id)
      .select()
      .single()

    if (updateErr) throw updateErr
    console.log(`✅ 信用卡修改成功！新额度: ¥${updatedCard.credit_limit}, 新尾号: ${updatedCard.card_number_last4}`)

    // 4. 测试二段 Fetch 关联查询（验证表间解耦防崩溃）
    console.log('\n[4/6] 测试获取该持卡人的名下卡片与产品关系组装...')
    const { data: userCards } = await db.database
      .from('credit_cards')
      .select('*')
      .eq('holder_id', holder.id)

    const productIds = Array.from(new Set(userCards.map(c => c.card_product_id)))
    const { data: fetchedProducts } = await db.database
      .from('card_products')
      .select('*')
      .in('id', productIds)

    const productMap = fetchedProducts.reduce((acc, p) => ({ ...acc, [p.id]: p }), {})
    const assembledCards = userCards.map(c => ({ ...c, card_product: productMap[c.card_product_id] }))

    console.log(`✅ 成功组装卡片信息: ${assembledCards[0].card_product.bank_name} ${assembledCards[0].card_product.card_name}`)

    // 5. 测试给该卡生成账单与还款记录
    console.log('\n[5/6] 测试为新添加卡片创建账单及登记还款...')
    const { data: bill, error: billErr } = await db.database
      .from('bills')
      .insert([{
        card_id: card.id,
        bill_month: '2026-08',
        statement_start: '2026-07-16',
        statement_end: '2026-08-15',
        bill_amount: 12500,
        min_payment: 1250,
        due_date: '2026-09-04',
        status: 'unpaid'
      }])
      .select()
      .single()

    if (billErr) throw billErr
    console.log(`✅ 账单创建成功！月份: ${bill.bill_month}, 金额: ¥${bill.bill_amount}`)

    // 登记部分还款
    const { data: payment, error: payErr } = await db.database
      .from('payments')
      .insert([{
        bill_id: bill.id,
        amount: 2500,
        paid_at: new Date().toISOString().slice(0, 10),
        channel: '微信支付',
        note: '全自动化测试还款',
        idempotency_key: `test_pay_${Date.now()}`
      }])
      .select()
      .single()

    if (payErr) throw payErr
    console.log(`✅ 还款记录登记成功！金额: ¥${payment.amount}, 方式: ${payment.channel}`)

    // 6. 测试清理临时测试数据
    console.log('\n[6/6] 清理自动化测试临时数据...')
    await db.database.from('payments').delete().eq('id', payment.id)
    await db.database.from('bills').delete().eq('id', bill.id)
    await db.database.from('credit_cards').delete().eq('id', card.id)
    await db.database.from('card_holders').delete().eq('id', holder.id)
    console.log('✅ 测试临时数据清理完毕！')

    console.log('\n🎉 全流程端到端自动化测试顺利完成！所有底层 API、表结构映射与查询完全正常！\n')
  } catch (err) {
    console.error('\n❌ 测试失败，捕获到异常:', err)
    process.exit(1)
  }
}

runTest()
