@echo off
:: ====================================================================
::  Flight Monitor - Windows One-Click Local Launcher
::  سامانه هوشمند پایش پرواز - اسکریپت اجرای خودکار روی ویندوز
:: ====================================================================

:: Set UTF-8 encoding so Persian text displays correctly in Windows CMD
chcp 65001 >nul

title سامانه هوشمند پایش پرواز - راه انداز محلی

echo =====================================================
echo    ✈️  سامانه هوشمند پایش پرواز تهران-نجف (اجرای لوکال)
echo =====================================================
echo [1/4] در حال بررسی ملزومات سیستم...
echo.

:: Check Node.js installation
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [خطا] Node.js روی سیستم شما نصب نیست!
    echo برای اجرای پروژه ابتدا باید Node.js را دانلود و نصب کنید.
    echo در حال باز کردن صفحه دانلود Node.js در مرورگر...
    start https://nodejs.org/
    echo.
    echo لطفا پس از نصب Node.js، مجدداً این فایل را اجرا کنید.
    pause
    exit /b
)

echo ✓ Node.js شناسایی شد.
echo.

:: [2/4] Setup Environment File
echo [2/4] بررسی فایل تنظیمات (.env)...
if not exist .env (
    echo فایل تنظیمات یافت نشد. در حال ایجاد فایل .env از نمونه...
    copy .env.example .env >nul
    echo.
    echo [مهم] فایل .env ایجاد شد. 
    echo لطفا کلید GEMINI_API_KEY خود را در صورت نیاز داخل آن قرار دهید.
) else (
    echo ✓ فایل تنظیمات (.env) موجود است.
)
echo.

:: [3/4] Install Dependencies
echo [3/4] بررسی و نصب کتابخانه‌ها (npm install)...
if not exist node_modules (
    echo در حال نصب کتابخانه‌ها... این فرآیند ممکن است کمی طول بکشد...
    call npm install
) else (
    echo ✓ کتابخانه‌ها قبلاً نصب شده‌اند.
)
echo.

:: [4/4] Launch Application
echo [4/4] آماده‌سازی برای اجرا...
echo =====================================================
echo کدام حالت را برای اجرا ترجیح می‌دهید؟
echo 1) حالت توسعه (Development Mode - داینامیک و سریع)
echo 2) حالت تولید (Production Mode - بیلد کامل و پایدار)
echo =====================================================
set /p choice="لطفا عدد مورد نظر را وارد کنید (پیش‌فرض 1): "

if "%choice%"=="2" (
    echo.
    echo در حال بیلد کردن پروژه...
    call npm run build
    echo.
    echo در حال اجرای سرور تولید...
    echo آدرس دسترسی در مرورگر: http://localhost:3000
    echo =====================================================
    call npm start
) else (
    echo.
    echo در حال اجرای سرور توسعه...
    echo آدرس دسترسی در مرورگر: http://localhost:3000
    echo =====================================================
    call npm run dev
)

pause
