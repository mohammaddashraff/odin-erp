"use client";

import Image from "next/image";

export default function CompanyLetterhead({ company, language = "en" }: { company: any; language?: "en" | "ar" }) {
  const name = language === "ar" ? company.nameAr || company.name : company.name;
  const details = [company.legalName && company.legalName !== name ? company.legalName : null, company.address, company.phone, company.email, company.website]
    .filter(Boolean);
  return (
    <section className="company-letterhead" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="company-letterhead-logo">
        {company.logoImage ? <Image src={company.logoImage} width={112} height={72} alt={name || "Company logo"} unoptimized /> : <span aria-hidden="true">{String(name || "C").slice(0, 2).toLocaleUpperCase()}</span>}
      </div>
      <div>
        <strong>{name || company.name}</strong>
        {details.map((value: string) => <small key={value}><bdi>{value}</bdi></small>)}
        {company.taxNumber || company.commercialRegistration ? (
          <small><bdi>{[company.taxNumber && `Tax: ${company.taxNumber}`, company.commercialRegistration && `CR: ${company.commercialRegistration}`].filter(Boolean).join(" · ")}</bdi></small>
        ) : null}
      </div>
    </section>
  );
}
