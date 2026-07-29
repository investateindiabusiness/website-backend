const chatbotFaqs = [

  // ==========================================================
  // GENERAL & PLATFORM
  // ==========================================================

  {
    id: "general-platform",
    audience: "public",
    category: "General & Platform",
    question: "What is Investate India?",
    answer:
      "Investate India is a technology-enabled investment ecosystem connecting global investors, builders, businesses, and professional service providers through verified opportunities, structured processes, and transparent collaboration.",
    order: 10,
    isActive: true,
  },

  {
    id: "general-purpose",
    audience: "public",
    category: "General & Platform",
    question: "What does Investate India do?",
    answer:
      "We help investors discover opportunities, builders showcase projects, service providers expand their professional network, and businesses explore structured capital solutions through a single integrated platform.",
    order: 20,
    isActive: true,
  },

  {
    id: "general-broker",
    audience: "public",
    category: "General & Platform",
    question: "Is Investate India a real estate broker?",
    answer:
      "No. Investate India is a facilitation and investment ecosystem. We connect verified stakeholders through transparent processes but do not operate as a traditional brokerage.",
    order: 30,
    isActive: true,
  },

  {
    id: "general-users",
    audience: "public",
    category: "General & Platform",
    question: "Who can use Investate India?",
    answer:
      "Investors, NRIs, builders, developers, businesses, startups, real estate professionals, legal experts, financial advisors, and other service providers can register based on their eligibility.",
    order: 40,
    isActive: true,
  },

  {
    id: "general-registration",
    audience: "public",
    category: "General & Platform",
    question: "Is registration free?",
    answer:
      "Registration is currently free for Investors, Builders, and Service Providers. Certain premium services, assessments, or advisory engagements may have applicable fees, which will always be communicated before proceeding.",
    order: 50,
    isActive: true,
  },

  {
    id: "general-opportunities",
    audience: "public",
    category: "General & Platform",
    question: "What investment opportunities are available?",
    answer:
      "The platform supports residential, commercial, plotted developments, villas, apartments, farm projects, industrial, warehousing, hospitality, mixed-use developments, and capital sourcing opportunities.",
    order: 60,
    isActive: true,
  },

  {
    id: "general-verification",
    audience: "public",
    category: "General & Platform",
    question: "How are projects verified?",
    answer:
      "Projects are reviewed using available documentation, regulatory approvals, legal information, developer background, delivery history, financial information, and other applicable due diligence parameters.",
    order: 70,
    isActive: true,
  },

  {
    id: "general-services",
    audience: "public",
    category: "General & Platform",
    question: "What services does Investate India provide?",
    answer:
      "Our ecosystem supports project discovery, builder promotion, professional service partnerships, capital sourcing, business networking, legal assistance, taxation support, property management, and investment facilitation.",
    order: 80,
    isActive: true,
  },

  {
    id: "general-global",
    audience: "public",
    category: "General & Platform",
    question: "Do you support international investors?",
    answer:
      "Yes. The platform is designed to support global investors, including NRIs and international stakeholders interested in Indian opportunities.",
    order: 90,
    isActive: true,
  },

  {
    id: "general-contact",
    audience: "public",
    category: "General & Platform",
    question: "How can I contact Investate India?",
    answer:
      "You can submit an enquiry through our Contact Us page or register on the platform to connect with our team regarding investments, builder partnerships, service partnerships, or capital sourcing.",
    order: 100,
    isActive: true,
  },

  // ==========================================================
  // INVESTOR
  // ==========================================================

  {
    id: "investor-register",
    audience: "public",
    category: "Investor",
    question: "How do I start investing?",
    answer:
      "Create your Investor account, complete profile verification, explore verified opportunities, shortlist projects, and submit your investment interest through the platform.",
    order: 110,
    isActive: true,
  },

  {
    id: "investor-kyc",
    audience: "public",
    category: "Investor",
    question: "Is KYC verification mandatory?",
    answer:
      "Yes. KYC verification helps create a secure, transparent, and trusted investment ecosystem for all participants.",
    order: 120,
    isActive: true,
  },

  {
    id: "investor-documents",
    audience: "public",
    category: "Investor",
    question: "What documents are required for KYC?",
    answer:
      "Depending on your profile, documents may include identity proof, address proof, PAN, passport, NRI documentation, or other supporting documents required during verification.",
    order: 130,
    isActive: true,
  },

  {
    id: "investor-types",
    audience: "public",
    category: "Investor",
    question: "What property types can I invest in?",
    answer:
      "Investors can explore apartments, villas, villa plots, residential plots, commercial properties, office spaces, warehouses, industrial projects, farm projects, hospitality developments, and other eligible opportunities.",
    order: 140,
    isActive: true,
  },

  {
    id: "investor-stage",
    audience: "public",
    category: "Investor",
    question: "Can I invest in pre-launch projects?",
    answer:
      "Yes. Depending on project availability, investors may explore pre-launch, new launch, under-construction, ready-to-move, rental, and resale opportunities.",
    order: 150,
    isActive: true,
  },

  {
    id: "investor-purpose",
    audience: "public",
    category: "Investor",
    question: "Can I choose my investment preferences?",
    answer:
      "Yes. During registration you can specify preferred investment categories, property types, locations, investment stage, budget, and investment objectives to receive more relevant opportunities.",
    order: 160,
    isActive: true,
  },

  {
    id: "investor-builder",
    audience: "public",
    category: "Investor",
    question: "Can I connect with builders?",
    answer:
      "Yes. The platform facilitates structured communication between verified investors and builders while maintaining transparency throughout the process.",
    order: 170,
    isActive: true,
  },

  {
    id: "investor-support",
    audience: "public",
    category: "Investor",
    question: "Do you provide legal and taxation support?",
    answer:
      "Yes. Investors can connect with verified professional service providers including legal experts, Chartered Accountants, tax advisors, compliance consultants, and property management professionals.",
    order: 180,
    isActive: true,
  },

  {
    id: "investor-dashboard",
    audience: "public",
    category: "Investor",
    question: "What can I manage from my dashboard?",
    answer:
      "Your dashboard allows you to manage your profile, saved opportunities, submitted interests, verification status, enquiries, and future platform services as they become available.",
    order: 190,
    isActive: true,
  },

  {
    id: "investor-after",
    audience: "public",
    category: "Investor",
    question: "Does Investate India support me after investment?",
    answer:
      "The platform aims to provide ongoing access to professional services such as legal guidance, taxation, compliance, property management, and other support depending on your requirements.",
    order: 200,
    isActive: true,
  },

  // ==========================================================
  // BUILDER
  // ==========================================================

  {
    id: "builder-register",
    audience: "public",
    category: "Builder",
    question: "Who can register as a Builder?",
    answer:
      "Verified builders, developers, construction companies, and project owners with eligible developments can register on Investate India.",
    order: 210,
    isActive: true,
  },

  {
    id: "builder-project-types",
    audience: "public",
    category: "Builder",
    question: "What types of projects can I list?",
    answer:
      "You can showcase residential, commercial, plotted developments, villas, apartments, industrial, warehousing, hospitality, mixed-use, township, and other eligible real estate projects.",
    order: 220,
    isActive: true,
  },

  {
    id: "builder-prelaunch",
    audience: "public",
    category: "Builder",
    question: "Can I list pre-launch projects?",
    answer:
      "Yes. Eligible pre-launch projects may be listed after completing the required documentation and platform verification process.",
    order: 230,
    isActive: true,
  },

  {
    id: "builder-multiple",
    audience: "public",
    category: "Builder",
    question: "Can I upload multiple projects?",
    answer:
      "Yes. Builders can manage multiple projects from a single verified account.",
    order: 240,
    isActive: true,
  },

  {
    id: "builder-edit",
    audience: "public",
    category: "Builder",
    question: "Can I edit my project information?",
    answer:
      "Yes. Builders can update project details, images, pricing, availability, and other information from their dashboard, subject to platform review where applicable.",
    order: 250,
    isActive: true,
  },

  {
    id: "builder-status",
    audience: "public",
    category: "Builder",
    question: "How can I check my project approval status?",
    answer:
      "Your Builder dashboard displays the current verification and approval status of every submitted project.",
    order: 260,
    isActive: true,
  },

  {
    id: "builder-review",
    audience: "public",
    category: "Builder",
    question: "How are builder projects reviewed?",
    answer:
      "Projects are evaluated using available documentation, approvals, developer background, legal information, financial details, and other applicable due diligence parameters.",
    order: 270,
    isActive: true,
  },

  {
    id: "builder-reject",
    audience: "public",
    category: "Builder",
    question: "Why was my project not approved?",
    answer:
      "Projects may require additional documentation, clarification, compliance updates, or corrections before approval. Our team will provide feedback wherever applicable.",
    order: 280,
    isActive: true,
  },

  {
    id: "builder-investors",
    audience: "public",
    category: "Builder",
    question: "Will my projects be visible to investors?",
    answer:
      "Yes. Approved projects become available to relevant investors based on their interests, investment preferences, and platform recommendations.",
    order: 290,
    isActive: true,
  },

  {
    id: "builder-global",
    audience: "public",
    category: "Builder",
    question: "Can NRIs discover my projects?",
    answer:
      "Yes. Verified projects may be presented to domestic and international investors, including NRIs, through the Investate India ecosystem.",
    order: 300,
    isActive: true,
  },

  {
    id: "builder-capital",
    audience: "public",
    category: "Builder",
    question: "Can I apply for capital support?",
    answer:
      "Yes. Eligible projects may apply for structured capital assessment, subject to financial evaluation, legal review, collateral assessment, and investment feasibility.",
    order: 310,
    isActive: true,
  },

  {
    id: "builder-presales",
    audience: "public",
    category: "Builder",
    question: "Do you support pre-sales opportunities?",
    answer:
      "Yes. Depending on project readiness and evaluation, eligible developments may be considered for pre-sales support and investor outreach.",
    order: 320,
    isActive: true,
  },

  {
    id: "builder-marketing",
    audience: "public",
    category: "Builder",
    question: "Can Investate India help promote my projects?",
    answer:
      "Yes. Approved builders may receive enhanced visibility through the platform, helping them connect with investors and qualified prospects.",
    order: 330,
    isActive: true,
  },

  {
    id: "builder-documents",
    audience: "public",
    category: "Builder",
    question: "What documents are generally required?",
    answer:
      "Depending on the project, documentation may include approvals, ownership information, company details, project information, plans, legal documents, and other supporting records.",
    order: 340,
    isActive: true,
  },

  {
    id: "builder-dashboard",
    audience: "public",
    category: "Builder",
    question: "What can I manage from my Builder dashboard?",
    answer:
      "Builders can manage projects, enquiries, profile information, project updates, verification status, and future platform services from a centralized dashboard.",
    order: 350,
    isActive: true,
  },
  // ==========================================================
  // SERVICE PROVIDER
  // ==========================================================

  {
    id: "sp-register",
    audience: "public",
    category: "Service Provider",
    question: "Who can become an Investate India Service Partner?",
    answer:
      "Professionals and companies offering real estate, financial, legal, advisory, compliance, construction, design, and related services can apply to become verified service partners.",
    order: 360,
    isActive: true,
  },

  {
    id: "sp-categories",
    audience: "public",
    category: "Service Provider",
    question: "What professional categories are accepted?",
    answer:
      "We welcome Real Estate Lawyers, Chartered Accountants & Tax Advisors, Compliance Consultants, Real Estate Agents, Property Management Companies, Property Valuation Experts, Financial Advisors, Insurance Advisors, Architects, Interior Designers, Construction Contractors, Immigration Consultants, and other professional service providers.",
    order: 370,
    isActive: true,
  },

  {
    id: "sp-company",
    audience: "public",
    category: "Service Provider",
    question: "Can companies register as Service Providers?",
    answer:
      "Yes. Individual professionals, firms, partnerships, LLPs, and registered companies can apply depending on their professional expertise.",
    order: 380,
    isActive: true,
  },

  {
    id: "sp-verification",
    audience: "public",
    category: "Service Provider",
    question: "How are Service Providers verified?",
    answer:
      "Applications are reviewed based on professional credentials, business profile, experience, documentation, and other applicable verification requirements.",
    order: 390,
    isActive: true,
  },

  {
    id: "sp-profile",
    audience: "public",
    category: "Service Provider",
    question: "Can I update my profile later?",
    answer:
      "Yes. You can update your company information, services, contact details, experience, and profile content through your dashboard.",
    order: 400,
    isActive: true,
  },

  {
    id: "sp-services",
    audience: "public",
    category: "Service Provider",
    question: "What services can I offer?",
    answer:
      "You may offer legal services, taxation, compliance, advisory, valuation, architecture, interiors, construction, property management, relocation assistance, insurance, financial consulting, and other approved professional services.",
    order: 410,
    isActive: true,
  },

  {
    id: "sp-clients",
    audience: "public",
    category: "Service Provider",
    question: "Who can connect with me?",
    answer:
      "Verified investors, builders, businesses, and other eligible users may connect with approved service providers through the platform.",
    order: 420,
    isActive: true,
  },

  {
    id: "sp-enquiries",
    audience: "public",
    category: "Service Provider",
    question: "How do I receive enquiries?",
    answer:
      "Relevant enquiries are routed through the platform, allowing verified users to connect with suitable professional partners.",
    order: 430,
    isActive: true,
  },

  {
    id: "sp-listing",
    audience: "public",
    category: "Service Provider",
    question: "Will my profile be visible publicly?",
    answer:
      "Approved service provider profiles may be displayed within the platform according to visibility settings and platform policies.",
    order: 440,
    isActive: true,
  },

  {
    id: "sp-benefits",
    audience: "public",
    category: "Service Provider",
    question: "How does Investate India help Service Providers?",
    answer:
      "We help professionals expand their visibility, build credibility, connect with qualified clients, and become part of a trusted investment ecosystem.",
    order: 450,
    isActive: true,
  },

  {
    id: "sp-multiple-services",
    audience: "public",
    category: "Service Provider",
    question: "Can I offer multiple services?",
    answer:
      "Yes. During registration you can choose multiple service categories based on your expertise and business offerings.",
    order: 460,
    isActive: true,
  },

  {
    id: "sp-global",
    audience: "public",
    category: "Service Provider",
    question: "Can I work with international clients?",
    answer:
      "Yes. The platform is designed to support global investors, including NRIs and overseas clients requiring services in India.",
    order: 470,
    isActive: true,
  },

  {
    id: "sp-dashboard",
    audience: "public",
    category: "Service Provider",
    question: "What can I manage from my dashboard?",
    answer:
      "You can manage your profile, service categories, enquiries, verification status, company information, and future platform features.",
    order: 480,
    isActive: true,
  },

  {
    id: "sp-fees",
    audience: "public",
    category: "Service Provider",
    question: "Are there any registration charges?",
    answer:
      "Registration is currently free. Any premium services or future subscription plans will be communicated transparently before activation.",
    order: 490,
    isActive: true,
  },

  {
    id: "sp-approval-time",
    audience: "public",
    category: "Service Provider",
    question: "How long does profile verification take?",
    answer:
      "Verification timelines depend on document completeness and review requirements. Our team processes applications as efficiently as possible.",
    order: 500,
    isActive: true,
  },
  // ==========================================================
  // CAPITAL SOURCING
  // ==========================================================

  {
    id: "capital-eligible",
    audience: "public",
    category: "Capital Sourcing",
    question: "Who can apply for Capital Sourcing?",
    answer:
      "Eligible real estate developers, infrastructure projects, established businesses, startups, and growth-oriented enterprises seeking structured capital support can submit their profile for evaluation.",
    order: 510,
    isActive: true,
  },

  {
    id: "capital-purpose",
    audience: "public",
    category: "Capital Sourcing",
    question: "What types of capital support do you facilitate?",
    answer:
      "Depending on project suitability, we facilitate structured capital solutions, project funding opportunities, pre-sales support, strategic partnerships, investor introductions, and business expansion support.",
    order: 520,
    isActive: true,
  },

  {
    id: "capital-industries",
    audience: "public",
    category: "Capital Sourcing",
    question: "Which industries are supported?",
    answer:
      "We primarily support real estate, infrastructure, hospitality, industrial developments, warehousing, manufacturing, technology businesses, and other scalable business opportunities.",
    order: 530,
    isActive: true,
  },

  {
    id: "capital-assessment",
    audience: "public",
    category: "Capital Sourcing",
    question: "Is project assessment free?",
    answer:
      "No. Professional project assessment is a paid service conducted by our dedicated evaluation team before capital sourcing discussions begin.",
    order: 540,
    isActive: true,
  },

  {
    id: "capital-fee",
    audience: "public",
    category: "Capital Sourcing",
    question: "Why is there an assessment fee?",
    answer:
      "Our specialists perform financial analysis, business evaluation, documentation review, legal assessment, market feasibility studies, and investment readiness evaluation before considering capital opportunities.",
    order: 550,
    isActive: true,
  },

  {
    id: "capital-duration",
    audience: "public",
    category: "Capital Sourcing",
    question: "How long does the assessment process take?",
    answer:
      "The complete evaluation generally takes between 2 and 4 weeks, depending on project complexity and the availability of required documentation.",
    order: 560,
    isActive: true,
  },

  {
    id: "capital-documents",
    audience: "public",
    category: "Capital Sourcing",
    question: "What documents are required?",
    answer:
      "Typical requirements include company profile, promoter information, financial statements, project details, funding requirements, legal approvals, collateral information, expected returns, and exit strategy documentation.",
    order: 570,
    isActive: true,
  },

  {
    id: "capital-collateral",
    audience: "public",
    category: "Capital Sourcing",
    question: "Is collateral required?",
    answer:
      "Depending on the investment structure, collateral, security, guarantees, or asset backing may be required during evaluation.",
    order: 580,
    isActive: true,
  },

  {
    id: "capital-security",
    audience: "public",
    category: "Capital Sourcing",
    question: "What types of security are considered?",
    answer:
      "Security may include land assets, completed properties, project assets, corporate guarantees, personal guarantees, or other acceptable collateral depending on the opportunity.",
    order: 590,
    isActive: true,
  },

  {
    id: "capital-exit",
    audience: "public",
    category: "Capital Sourcing",
    question: "Is an investor exit plan required?",
    answer:
      "Yes. Every opportunity should include a clearly defined exit strategy explaining how investors are expected to receive returns and conclude the investment.",
    order: 600,
    isActive: true,
  },

  {
    id: "capital-returns",
    audience: "public",
    category: "Capital Sourcing",
    question: "Do I need to provide return projections?",
    answer:
      "Yes. Expected returns, revenue assumptions, business projections, and financial performance should be included wherever applicable.",
    order: 610,
    isActive: true,
  },

  {
    id: "capital-presales",
    audience: "public",
    category: "Capital Sourcing",
    question: "Can real estate projects seek pre-sales support?",
    answer:
      "Yes. Eligible projects may also be evaluated for structured pre-sales opportunities depending on project readiness and market suitability.",
    order: 620,
    isActive: true,
  },

  {
    id: "capital-legal",
    audience: "public",
    category: "Capital Sourcing",
    question: "Do projects need legal compliance?",
    answer:
      "Yes. Projects should satisfy applicable legal requirements, approvals, ownership documentation, and compliance standards before progressing through the evaluation process.",
    order: 630,
    isActive: true,
  },

  {
    id: "capital-confidential",
    audience: "public",
    category: "Capital Sourcing",
    question: "Will my business information remain confidential?",
    answer:
      "Yes. All submitted information is handled confidentially. Information is shared only as required during the evaluation process and appropriate confidentiality practices are followed.",
    order: 640,
    isActive: true,
  },

  {
    id: "capital-guarantee",
    audience: "public",
    category: "Capital Sourcing",
    question: "Does completing the assessment guarantee funding?",
    answer:
      "No. Assessment does not guarantee funding. Capital decisions depend on project quality, financial viability, collateral, legal compliance, investor suitability, and overall investment readiness.",
    order: 650,
    isActive: true,
  },

  {
    id: "capital-followup",
    audience: "public",
    category: "Capital Sourcing",
    question: "What happens after my assessment is completed?",
    answer:
      "Suitable opportunities may proceed to discussions regarding structured capital solutions, strategic partnerships, investor engagement, or other funding options based on evaluation outcomes.",
    order: 660,
    isActive: true,
  },

  {
    id: "capital-contact",
    audience: "public",
    category: "Capital Sourcing",
    question: "How do I begin the Capital Sourcing process?",
    answer:
      "Submit your enquiry through the Capital Sourcing section or Contact Us page. Our team will guide you through documentation, assessment, and the next steps.",
    order: 670,
    isActive: true,
  },

];

module.exports = { chatbotFaqs };

