// db/seed.ts
import { createClient } from '@insforge/sdk'
import 'dotenv/config'

async function seed() {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL
  const key = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY
  
  if (!url || !key) {
    console.error('Missing env vars')
    return
  }

  const client = createClient({ baseUrl: url, anonKey: key })

  console.log('🚀 Starting seeding...')

  // 1. 插入银行数据
  const banks = [
    { name: '招商银行', country: 'CN' },
    { name: '工商银行', country: 'CN' },
    { name: '建设银行', country: 'CN' },
    { name: '广发银行', country: 'CN' },
    { name: '汇丰银行', country: 'HK' }
  ]

  // 1. 尝试清理旧数据或直接插入
  const { data: seededBanks, error: banksError } = await client.database
    .from('banks')
    .upsert(banks, { onConflict: 'name' })
    .select()

  if (banksError) {
    console.error('❌ Banks seeding failed:', JSON.stringify(banksError, null, 2))
    return
  }
  console.log(`✅ Seeded ${seededBanks?.length} banks`)

  const bankMap = Object.fromEntries(seededBanks.map(b => [b.name, b.id]))

  // 2. 插入卡产品数据
  const cardProducts = [
    {
      bank_id: bankMap['招商银行'],
      bank_name: '招商银行',
      card_name: '经典白金卡',
      currency: 'CNY',
      country: 'CN',
      payment_due_type: 'after_billing',
      payment_due_value: 20,
      annual_fee: 3600,
      annual_fee_waiver: '10000 积分兑换',
      description_md: '招商银行经典白金卡是高端持卡人的首选，提供体检、高尔夫、机场贵宾室等高价值权益。'
    },
    {
      bank_id: bankMap['工商银行'],
      bank_name: '工商银行',
      card_name: '环球旅行卡',
      currency: 'CNY',
      country: 'CN',
      payment_due_type: 'after_billing',
      payment_due_value: 25,
      annual_fee: 0,
      annual_fee_waiver: '刷卡 5 次免年费',
      description_md: '工行环球旅行卡，全币种免货币转换费，是海外旅游和购物的利器。'
    },
    {
      bank_id: bankMap['建设银行'],
      bank_name: '建设银行',
      card_name: '大山白',
      currency: 'CNY',
      country: 'CN',
      payment_due_type: 'after_billing',
      payment_due_value: 20,
      annual_fee: 1800,
      annual_fee_waiver: '40 万积分兑换',
      description_md: '建行龙卡尊享白金卡（大山白），权益涵盖酒店住宿、接送机、代驾等。'
    },
    {
      bank_id: bankMap['广发银行'],
      bank_name: '广发银行',
      card_name: '精制臻尚白金卡',
      currency: 'CNY',
      country: 'CN',
      payment_due_type: 'after_billing',
      payment_due_value: 20,
      annual_fee: 480,
      annual_fee_waiver: '发卡 90 天内刷卡 3 笔免首年',
      description_md: '高铁管家权益，无限次广发自营高铁贵宾室。'
    }
  ]

  try {
    const { data, error } = await client.database
      .from('card_products')
      .upsert(cardProducts, { onConflict: 'bank_name,card_name' })
      .select()

    if (error) {
      console.error('❌ Card products seeding failed:', JSON.stringify(error, null, 2))
    } else {
      console.log(`✅ Seeded ${data?.length} card products`)
    }
  } catch (err) {
    console.error('🔥 Unexpected error:', err)
  }
}

seed()
