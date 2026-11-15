
import { GoogleGenAI, Type } from "@google/genai";
import { Customer, Order, Product } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getMarketingInsights = async (customer: Customer, recentOrders: Order[], products: Product[]) => {
  try {
    const prompt = `
      بصفتك خبير تسويق لشركة زيوت عطرية بالجملة.
      العميل: ${customer.name}
      تصنيفه: ${customer.classification}
      إجمالي مشترياته: ${customer.totalSpent} جنيه.
      الزيوت المتاحة لدينا: ${products.map(p => p.name).join(', ')}.
      
      اكتب رسالة تسويقية مخصصة (Re-marketing) لهذا العميل باللغة العربية بلهجة احترافية وودودة لتشجيعه على الطلب مرة أخرى.
      واقترح 3 منتجات قد تهمه بناءً على كونه عميل ${customer.classification}.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "عذراً، حدث خطأ أثناء توليد الاقتراحات التسويقية.";
  }
};

export const classifyCustomerAI = async (customerData: any) => {
    return customerData.totalSpent > 10000 ? 'ذهبي' : customerData.totalSpent > 5000 ? 'فضي' : 'عادي';
};
