#!/usr/bin/env bash

# ====================================================================
#  Flight Monitor - Termux Setup Script (for Android)
#  سیستم هوشمند پایش پرواز - اسکریپت نصب و راه‌اندازی روی گوشی (ترموکس)
# ====================================================================

# Color definitions for a beautiful terminal interface
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

clear
echo -e "${CYAN}=====================================================${NC}"
echo -e "${GREEN}   ✈️  سامانه هوشمند پایش پرواز تهران-نجف (نسخه موبایل)  ${NC}"
echo -e "${CYAN}=====================================================${NC}"
echo -e "${BLUE}[1/5] شروع فرآیند آماده‌سازی و نصب روی ترموکس...${NC}"
echo ""

# Check if we are running in Termux
if [ -d "/data/data/com.termux" ]; then
    echo -e "${GREEN}✓ محیط ترموکس در اندروید به درستی شناسایی شد.${NC}"
else
    echo -e "${YELLOW}⚠️ توجه: این اسکریپت برای ترموکس در اندروید بهینه‌سازی شده است، اما در سایر محیط‌های لینوکسی نیز قابل اجراست.${NC}"
fi

# Step 2: Update and Install Node.js
echo ""
echo -e "${BLUE}[2/5] بررسی و نصب ملزومات (Node.js و npm)...${NC}"
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    echo -e "${GREEN}✓ Node.js قبلاً نصب شده است: ${NODE_VER}${NC}"
else
    echo -e "${YELLOW}⏳ در حال نصب Node.js (نسخه پایدار LTS)...${NC}"
    pkg update -y && pkg install nodejs-lts -y
    if command -v node >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Node.js با موفقیت نصب شد.${NC}"
    else
        echo -e "${RED}❌ خطا در نصب Node.js. لطفاً ابتدا به صورت دستی فرمان 'pkg install nodejs' را اجرا کنید.${NC}"
        exit 1
    fi
fi

# Step 3: Install Dependencies
echo ""
echo -e "${BLUE}[3/5] در حال نصب بسته‌های نرم‌افزاری (npm install)...${NC}"
echo -e "${YELLOW}این کار ممکن است ۱ الی ۲ دقیقه طول بکشد...${NC}"
npm install

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ بسته‌های نرم‌افزاری با موفقیت نصب شدند.${NC}"
else
    echo -e "${RED}❌ خطا در نصب بسته‌ها. اتصال اینترنت خود را بررسی کنید (در صورت لزوم از ابزار رفع تحریم استفاده کنید).${NC}"
    exit 1
fi

# Step 4: Build the Application
echo ""
echo -e "${BLUE}[4/5] در حال کامپایل و بیلد کردن برنامه (React + Express)...${NC}"
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ برنامه با موفقیت کامپایل و آماده اجرا شد.${NC}"
else
    echo -e "${RED}❌ خطا در بیلد کردن برنامه.${NC}"
    exit 1
fi

# Step 5: Create Launcher Script
echo ""
echo -e "${BLUE}[5/5] ایجاد میانبر سریع برای اجرای آسان...${NC}"

cat << 'EOF' > start.sh
#!/usr/bin/env bash
clear
echo "====================================================="
echo "   ✈️ در حال اجرای سامانه پایش پرواز روی گوشی..."
echo "====================================================="
# Prevent phone from sleeping during monitoring
if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock
    echo "✓ قابلیت جلوگیری از خواب رفتن پردازنده (Wake Lock) فعال شد."
fi
echo ""
echo "🔗 آدرس کنترل‌پنل در مرورگر گوشی شما: http://localhost:3000"
echo "برای خروج از برنامه، کلیدهای Ctrl + C را همزمان فشار دهید."
echo "====================================================="
echo ""
npm start
EOF

chmod +x start.sh

echo -e "${GREEN}✓ اسکریپت اجرای سریع با نام ${YELLOW}start.sh${GREEN} ایجاد شد.${NC}"
echo ""
echo -e "${CYAN}=====================================================${NC}"
echo -e "${GREEN}       🎉 راه‌اندازی اولیه با موفقیت انجام شد! 🎉      ${NC}"
echo -e "${CYAN}=====================================================${NC}"
echo ""
echo -e "💡 ${YELLOW}دستورالعمل اجرا روی گوشی:${NC}"
echo -e "۱. برای دفعات بعدی فقط کافیست دستور زیر را وارد کنید:"
echo -e "   ${CYAN}./start.sh${NC}"
echo ""
echo -e "۲. پس از اجرا، مرورگر گوشی خود را باز کرده و به آدرس زیر بروید:"
echo -e "   ${GREEN}http://localhost:3000${NC}"
echo ""
echo -e "۳. ${YELLOW}نکته طلایی (تبدیل به اپلیکیشن اندروید):${NC}"
echo -e "   وقتی سایت را در مرورگر کروم گوشی باز کردید، منوی سه نقطه را بزنید و گزینه"
echo -e "   ${GREEN}Add to Home Screen (افزودن به صفحه اصلی)${NC} را انتخاب کنید."
echo -e "   برنامه با آیکون اختصاصی و بدون نوار آدرس مرورگر به صورت یک اپلیکیشن مجزا"
echo -e "   روی صفحه گوشی شما نصب خواهد شد!"
echo ""
echo -e "۴. ${YELLOW}نکته کارکرد در پس‌زمینه:${NC}"
echo -e "   برای اینکه گوشی وقتی قفل می‌شود پایش را متوقف نکند، نوتیفیکیشن ترموکس را"
echo -e "   پایین بکشید و دکمه ${CYAN}Acquire wake-lock${NC} را بزنید تا پردازش ادامه یابد."
echo -e "   همچنین بهتر است بخش بهینه‌سازی باتری (Battery Optimization) را برای ترموکس غیرفعال کنید."
echo ""
echo -e "${CYAN}=====================================================${NC}"

# Ask user if they want to run it right now
read -p "آیا می‌خواهید برنامه همین الان اجرا شود؟ (y/n): " RUN_NOW
if [[ "$RUN_NOW" =~ ^[Yy]$ ]]; then
    ./start.sh
fi
