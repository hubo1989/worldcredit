import { createClient } from '@insforge/sdk'
import { config } from 'dotenv'
config({ path: ['.env.local', '.env'] })

async function seed() {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL
  const key = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY
  
  if (!url || !key) {
    console.error('Missing env vars')
    return
  }

  const client = createClient({ baseUrl: url, anonKey: key })
  console.log('🚀 Starting massive generic and specific seeding...')

  const initBanks = [
    // 中国：六大国有行
    ...["中国工商银行", "中国农业银行", "中国银行", "中国建设银行", "交通银行", "中国邮政储蓄银行"].map(name => ({ name, country: 'CN' })),
    // 中国：12家全国性股份制银行
    ...["招商银行", "上海浦东发展银行", "中信银行", "中国光大银行", "华夏银行", "中国民生银行", "广发银行", "兴业银行", "平安银行", "浙商银行", "渤海银行", "恒丰银行"].map(name => ({ name, country: 'CN' })),
    // 中国：30家头部城商行/农商行
    ...["北京银行", "上海银行", "江苏银行", "宁波银行", "南京银行", "杭州银行", "徽商银行", "盛京银行", "重庆银行", "哈尔滨银行", "贵阳银行", "锦州银行", "郑州银行", "青岛银行", "长沙银行", "苏州银行", "广州银行", "汉口银行", "东莞银行", "天津银行", "中原银行", "晋商银行", "长安银行", "河北银行", "大连银行", "齐鲁银行", "成都银行", "九江银行", "昆仑银行", "富滇银行"].map(name => ({ name, country: 'CN' })),
    // 美国：10家主流银行及发卡机构
    ...["JPMorgan Chase", "American Express", "Citibank", "Bank of America", "Capital One", "Discover", "U.S. Bank", "Wells Fargo", "Barclays US", "Synchrony Bank"].map(name => ({ name, country: 'US' })),
    // 香港：10家主流银行
    ...["HSBC HK", "Hang Seng Bank", "Standard Chartered HK", "Bank of China (Hong Kong)", "The Bank of East Asia", "DBS Bank (Hong Kong)", "Citibank HK", "CCB Asia", "ICBC Asia", "Chong Hing Bank"].map(name => ({ name, country: 'HK' })),
  ]

  // 1. 获取现有银行，仅插入缺少的
  const { data: existingBanks } = await client.database.from('banks').select('id, name')
  const existingBankNames = new Set(existingBanks?.map((b: any) => b.name) || [])
  
  const banksToInsert = initBanks.filter(b => !existingBankNames.has(b.name))
  if (banksToInsert.length > 0) {
    const { error: banksError } = await client.database
      .from('banks')
      .insert(banksToInsert)
    if (banksError) {
      console.error('❌ Banks insert failed:', banksError)
      return
    }
  }

  const { data: seededBanks, error: allBanksError } = await client.database.from('banks').select('*')
  if (allBanksError) {
    console.error('❌ Could not fetch banks:', allBanksError)
    return
  }
  console.log(`✅ Seeded ${seededBanks?.length || 0} banks.`)
  if (!seededBanks) return

  const bankMap = Object.fromEntries(seededBanks.map(b => [b.name, b.id]))

  // 2. 准备卡产品
  const cardProducts: any[] = []

  // 特殊著名卡片定义
  const specificCards: Record<string, any[]> = {
    "招商银行": [
      { card_name: '经典版白金信用卡', annual_fee: 3600, annual_fee_waiver: '10000 招行永久积分兑换年费', description_md: '自带每年一次免费体检及洁牙，拥有境内外机场贵宾厅权益。' },
      { card_name: '百夫长黑金卡', annual_fee: 18000, annual_fee_waiver: '刚性年费', description_md: '顶级黑卡，提供 FHR 奢华酒店、私人管家及顶级航司高卡会籍。' },
      { card_name: '自由人生白金卡（鸟白）', annual_fee: 800, annual_fee_waiver: '首年免，次年起消费满9万元免', description_md: '适合年轻人的入门白金，提供每月2次音乐/体育活动抢票。' },
      { card_name: '百夫长白金卡', annual_fee: 3600, annual_fee_waiver: '刚性年费', description_md: '配备 FHR 酒店礼遇和无限次 PP 面膳贵宾厅。' },
    ],
    "中国建设银行": [
      { card_name: '龙卡尊享白金信用卡（大山白）', annual_fee: 1800, annual_fee_waiver: '可用 40 万综合积分兑换年费', description_md: '著名“大山白”，配备高尔夫、接送机、酒店一次预订及无限次龙腾权益。' },
      { card_name: 'MUSE 信用卡', annual_fee: 580, annual_fee_waiver: '刷卡免年费', description_md: '专为高定奢侈品牌提供的返现神卡，特定商户笔笔返现。' }
    ],
    "中国农业银行": [
      { card_name: '尊然白金信用卡（精粹版）', annual_fee: 880, annual_fee_waiver: '刷卡 30 次免次年年费', description_md: '老牌免年费高端卡代表，无限次 CIP 及随心接送机服务。' },
      { card_name: '漂亮升级妈妈信用卡', annual_fee: 160, annual_fee_waiver: '刷卡 5 次免次年', description_md: '面向亲子家庭的爆款羊毛卡，每月专属积分兑礼。' }
    ],
    "交通银行": [
      { card_name: '白金信用卡（白麒麟）', annual_fee: 1000, annual_fee_waiver: '可用 25 万积分兑换', description_md: '家庭出游利器，附带6次酒后代驾、各类延误险和机场贵宾厅。' },
      { card_name: '优逸白金信用卡（Y-Power）', annual_fee: 500, annual_fee_waiver: '刷卡 6 次免次年', description_md: '免签单积分，境外10倍积分。' }
    ],
    "JPMorgan Chase": [
      { card_name: 'Chase Sapphire Reserve', annual_fee: 550, annual_fee_waiver: '刚性年费', description_md: '$300 travel credit, TSA PreCheck, Priority Pass, and 3x points on travel/dining.' },
      { card_name: 'Chase Sapphire Preferred', annual_fee: 95, annual_fee_waiver: '刚性年费', description_md: 'Excellent entry-level travel card. 2x points on travel/dining.' },
      { card_name: 'Chase Freedom Unlimited', annual_fee: 0, annual_fee_waiver: '无年费', description_md: '1.5% cash back on all purchases, 3% on dining/drugstores.' },
      { card_name: 'Chase Freedom Flex', annual_fee: 0, annual_fee_waiver: '无年费', description_md: '5% rotating categories. Includes cell phone protection.' }
    ],
    "American Express": [
      { card_name: 'The Platinum Card', annual_fee: 695, annual_fee_waiver: '刚性年费', description_md: 'Global Lounge Collection, 5x points on flights, Uber credits, and elite status.' },
      { card_name: 'American Express Gold Card', annual_fee: 250, annual_fee_waiver: '刚性年费', description_md: '4x points on restaurants and US supermarkets. $120 dining credit.' },
      { card_name: 'Blue Cash Everyday', annual_fee: 0, annual_fee_waiver: '无年费', description_md: '3% cash back on US supermarkets, US gas stations, and online retail.' }
    ],
    "HSBC HK": [
      { card_name: 'HSBC EveryMile Credit Card', annual_fee: 2000, annual_fee_waiver: '首年免，可用理财结余豁免免', description_md: 'HK$2 = 1 Asia Mile for everyday spending.' },
      { card_name: 'HSBC Visa Signature Card', annual_fee: 2000, annual_fee_waiver: '首两年免', description_md: 'Excellent multi-category multiplier, particularly on dining and overseas spend.' },
      { card_name: 'HSBC Red Credit Card', annual_fee: 0, annual_fee_waiver: '永久免年费', description_md: '4% RewardCash on online spend. Very popular for eCommerce.' }
    ]
  }

  // 为每个国家生成泛用的标准卡套装
  // 每家银行我们赋予了标准系列的普卡、金卡、各类白金、钻石卡等，结合特定卡，确保每家银行都有至少5-10种卡，总数500+
  const cnGenerics = ['普卡', '金卡', '标准白金卡', '钻石卡', '车主信用卡', '航空联名信用卡', '视频会员联名卡', '高校校友卡', '女性专属卡']
  const usGenerics = ['Cash Back Card', 'Travel Rewards Card', 'Student Card', 'Business Credit Card', 'Secured Credit Card', 'Airline Co-Branded Card', 'Hotel Co-Branded Card']
  const hkGenerics = ['Classic Card', 'Gold Card', 'Platinum Card', 'Visa Signature', 'World Mastercard', 'UnionPay Dual Currency Card']

  for (const b of initBanks) {
    const bId = bankMap[b.name]
    if (!bId) continue
    
    // 如果有特殊定义的卡片优先加入
    if (specificCards[b.name]) {
      specificCards[b.name].forEach(card => {
        cardProducts.push({
          bank_id: bId,
          bank_name: b.name,
          country: b.country,
          payment_due_type: 'after_billing',
          payment_due_value: 20,
          currency: b.country === 'CN' ? 'CNY' : (b.country === 'US' ? 'USD' : 'HKD'),
          ...card
        })
      })
    }

    // 生成通用系列卡片（排除特殊卡中已有的同名后缀，其实名字不同就行）
    // 为了使数据量超过 500（70银行 * 8张通用卡 = 560+ ），根据国家分配
    const genList = b.country === 'CN' ? cnGenerics : (b.country === 'US' ? usGenerics : hkGenerics)
    
    genList.forEach((suffix, idx) => {
      let limitMin = 0
      let annualFee = 0
      let waiver = '无年费'
      
      if (suffix.includes('白金') || suffix.includes('Signature') || suffix.includes('World')) {
        annualFee = b.country === 'CN' ? 800 : (b.country === 'US' ? 95 : 1000)
        waiver = b.country === 'CN' ? '刷卡 6 次免次年' : '消费满额豁免'
      } else if (suffix.includes('钻石') || suffix.includes('Business')) {
        annualFee = b.country === 'CN' ? 3600 : (b.country === 'US' ? 450 : 2000)
        waiver = '刚性年费'
      } else if (suffix.includes('金卡') || suffix.includes('Platinum Card')) {
        annualFee = b.country === 'CN' ? 100 : 0
        waiver = b.country === 'CN' ? '刷卡 3 次免本年' : '无年费'
      }
      
      cardProducts.push({
         bank_id: bId,
         bank_name: b.name,
         card_name: `${b.name} ${suffix}`,
         country: b.country,
         payment_due_type: 'after_billing',
         payment_due_value: 20 + (idx % 5),  // 随机制定免息日账单偏移 20-25
         currency: b.country === 'CN' ? 'CNY' : (b.country === 'US' ? 'USD' : 'HKD'),
         annual_fee: annualFee,
         annual_fee_waiver: waiver,
         description_md: `基础${suffix}，提供日常消费积分与基本返现优惠。\n\n${b.name} 全球服务网络支持，畅享当地指定商户特权。`
      })
    })
  }

  // 分批插入避免 payload 过大
  const batchSize = 100
  let totalInserted = 0

  // 获取现有卡产品以便过滤重复
  const { data: existingCards } = await client.database.from('card_products').select('bank_name, card_name')
  const existingSet = new Set(existingCards?.map((c: any) => `${c.bank_name}-${c.card_name}`) || [])

  const cardsToInsert = cardProducts.filter(c => !existingSet.has(`${c.bank_name}-${c.card_name}`))

  for (let i = 0; i < cardsToInsert.length; i += batchSize) {
    const chunk = cardsToInsert.slice(i, i + batchSize)
    const { data: cData, error: cErr } = await client.database
      .from('card_products')
      .insert(chunk)
      .select('id')
    
    if (cErr) {
      console.error(`❌ Card products chunk ${i} seeding failed:`, cErr)
    } else {
      totalInserted += cData?.length || 0
      console.log(`⏳ Inserted chunk ${Math.floor(i / batchSize) + 1}, accumulated ${totalInserted} cards...`)
    }
  }

  console.log(`\n🎉 Seeding completed! \n  Total Banks: ${seededBanks.length} \n  Total Cards: ${totalInserted} `)
}

seed()
