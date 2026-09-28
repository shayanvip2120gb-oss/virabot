import React, { useState } from 'react';
import {
  MessageSquare,
  BarChart3,
  Code2,
  Server,
  Download,
  Copy,
  Check,
  Send,
  UserCheck,
  Phone,
  ShieldCheck,
  Users,
  Clock,
  Sparkles,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Terminal,
  FileCode,
  Radio,
  Sliders,
  Play,
  RotateCcw,
  AlertCircle
} from 'lucide-react';
import JSZip from 'jszip';
import { BOT_FILES, BotFile } from './botFiles';

interface SimMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  buttons?: Array<{ text: string; action: string; url?: string }>;
  time: string;
}

interface SimulatedUser {
  id: number;
  telegram_id: string;
  name: string;
  username: string;
  phone: string;
  phone_method: 'contact_share' | 'manual_text';
  phone_verified: boolean;
  public_channel_verified: boolean;
  is_eligible: boolean;
  private_channel_status: 'none' | 'pending' | 'approved';
  created_at: string;
}

let messageCounter = 0;
const nextMsgId = () => {
  messageCounter += 1;
  return `msg_${Date.now()}_${messageCounter}_${Math.random().toString(36).substring(2, 7)}`;
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'dashboard' | 'code' | 'deployment'>('simulator');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<BotFile>(BOT_FILES[0]);
  const [zipDownloading, setZipDownloading] = useState(false);

  const [simStep, setSimStep] = useState<'start' | 'name' | 'phone' | 'channel' | 'eligible' | 'requested' | 'approved'>('start');
  const [simUserName, setSimUserName] = useState('');
  const [simUserPhone, setSimUserPhone] = useState('');
  const [simPhoneMethod, setSimPhoneMethod] = useState<'contact_share' | 'manual_text'>('contact_share');
  const [isChannelMember, setIsChannelMember] = useState(false);
  const [requirePublicChannel, setRequirePublicChannel] = useState(true);
  const [inputText, setInputText] = useState('');
  const [hasEarlyJoinRequest, setHasEarlyJoinRequest] = useState(false);

  const [messages, setMessages] = useState<SimMessage[]>([
    {
      id: 'init_msg_1',
      sender: 'bot',
      text: "سلام کاربر عزیز! 👋\n\nبه مینی‌دوره رایگان ویرا انگلیش خوش اومدی.\nتوی این مینی‌دوره قراره مهم‌ترین تکنیک‌های یادگیری مکالمه انگلیسی رو با هم یاد بگیریم.\n\nبرای شروع، لطفاً دکمه زیر رو بزن تا مراحل رو با هم پیش بریم:",
      buttons: [{ text: 'دریافت دسترسی رایگان 🚀', action: 'start_registration' }],
      time: '12:00'
    }
  ]);

  const [simulatedUsers, setSimulatedUsers] = useState<SimulatedUser[]>([
    {
      id: 1,
      telegram_id: '98432101',
      name: 'علی محمدی',
      username: 'ali_mohammadi',
      phone: '09121112233',
      phone_method: 'contact_share',
      phone_verified: true,
      public_channel_verified: true,
      is_eligible: true,
      private_channel_status: 'approved',
      created_at: '1403/07/06 10:20'
    },
    {
      id: 2,
      telegram_id: '87654321',
      name: 'سارا رضایی',
      username: 'sara_rezaei',
      phone: '09359876543',
      phone_method: 'manual_text',
      phone_verified: false,
      public_channel_verified: true,
      is_eligible: true,
      private_channel_status: 'approved',
      created_at: '1403/07/06 11:15'
    },
    {
      id: 3,
      telegram_id: '65432198',
      name: 'مهدی کریمی',
      username: 'mehdi_k',
      phone: '09193334455',
      phone_method: 'contact_share',
      phone_verified: true,
      public_channel_verified: true,
      is_eligible: true,
      private_channel_status: 'pending',
      created_at: '1403/07/06 12:45'
    },
    {
      id: 4,
      telegram_id: '54321098',
      name: 'پریسا احمدی',
      username: 'parisa_ah',
      phone: '09027778899',
      phone_method: 'manual_text',
      phone_verified: false,
      public_channel_verified: false,
      is_eligible: false,
      private_channel_status: 'none',
      created_at: '1403/07/06 14:10'
    }
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedUser, setSelectedUser] = useState<SimulatedUser | null>(null);
  const [manualApproveReason, setManualApproveReason] = useState('');

  const [broadcastTitle, setBroadcastTitle] = useState('شروع جلسه اول مینی‌دوره');
  const [broadcastText, setBroadcastText] = useState('سلام {name} عزیز! 🌸\n\nدرس اول مینی‌دوره مکالمه ویرا در کانال خصوصی بارگذاری شد.\nهمین حالا می‌تونی تماشا کنی.');
  const [broadcastSegment, setBroadcastSegment] = useState('eligible');
  const [broadcastButtonText, setBroadcastButtonText] = useState('ورود به درس اول');
  const [broadcastButtonUrl, setBroadcastButtonUrl] = useState('https://t.me/viraa_english');
  const [broadcastStatus, setBroadcastStatus] = useState<'idle' | 'sending' | 'completed'>('idle');
  const [broadcastProgress, setBroadcastProgress] = useState(0);

  const getTimeString = () => {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const handleSimButton = (action: string) => {
    if (action === 'start_registration') {
      const userMsg: SimMessage = {
        id: nextMsgId(),
        sender: 'user',
        text: 'دریافت دسترسی رایگان 🚀',
        time: getTimeString()
      };
      const botMsg: SimMessage = {
        id: nextMsgId(),
        sender: 'bot',
        text: "خیلی خوشحالیم که همراه مایی! ✨\n\nدوست داری با چه اسمی صدات کنیم؟\nلطفاً نام یا نام خانوادگیت رو بنویس:",
        time: getTimeString()
      };
      setMessages((prev) => [...prev, userMsg, botMsg]);
      setSimStep('name');
    } else if (action === 'check_channel') {
      const userMsg: SimMessage = {
        id: nextMsgId(),
        sender: 'user',
        text: 'عضو شدم؛ بررسی کن ✅',
        time: getTimeString()
      };

      if (!isChannelMember) {
        const botMsg: SimMessage = {
          id: nextMsgId(),
          sender: 'bot',
          text: "هنوز عضویت شما در کانال عمومی تأیید نشده است. لطفاً ابتدا در کانال عضو شده و سپس مجدداً دکمه بررسی را بزنید:",
          buttons: [
            { text: 'عضویت در کانال عمومی ویرا 📢', action: 'open_channel', url: 'https://t.me/viraa_english' },
            { text: 'عضو شدم؛ بررسی کن ✅', action: 'check_channel' }
          ],
          time: getTimeString()
        };
        setMessages((prev) => [...prev, userMsg, botMsg]);
      } else {
        grantSimEligibility(userMsg);
      }
    } else if (action === 'send_join_request') {
      triggerJoinRequest();
    }
  };

  const grantSimEligibility = (userMsg?: SimMessage) => {
    const newMessages: SimMessage[] = userMsg ? [userMsg] : [];
    const botMsg: SimMessage = {
      id: nextMsgId(),
      sender: 'bot',
      text: `تبریک ${simUserName || 'کاربر'} عزیز! 🎉\n\nثبت‌نامت تکمیل شد و دسترسی رایگان برات باز شد.\nحالا روی دکمه زیر کلیک کن و دکمه Request to Join (درخواست عضویت) رو بزن تا بلافاصله به کانال اختصاصی مینی‌دوره اضافه بشی:`,
      buttons: [
        { text: 'ورود به کانال مینی‌دوره 🎓 (لینک درخواست‌دار)', action: 'send_join_request', url: 'https://t.me/+join_viraa_mini_course' }
      ],
      time: getTimeString()
    };
    newMessages.push(botMsg);
    setMessages((prev) => [...prev, ...newMessages]);
    setSimStep('eligible');

    if (hasEarlyJoinRequest) {
      setTimeout(() => {
        autoApproveJoinRequest();
      }, 1200);
    }
  };

  const handleSimInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const text = inputText.trim();
    setInputText('');

    if (simStep === 'name') {
      setSimUserName(text);
      const userMsg: SimMessage = {
        id: nextMsgId(),
        sender: 'user',
        text: text,
        time: getTimeString()
      };
      const botMsg: SimMessage = {
        id: nextMsgId(),
        sender: 'bot',
        text: `ممنون ${text} عزیز! 🌹\n\nجهت ثبت‌نام قطعی و ارسال نکات پشتیبانی دوره، شماره تماست رو برامون بفرست.\nمی‌تونی با زدن دکمه زیر شماره تلگرامت رو بفرستی، یا دستی تایپش کنی:`,
        buttons: [{ text: '📱 ارسال شماره من (تأیید رسمی تلگرام)', action: 'share_contact' }],
        time: getTimeString()
      };
      setMessages((prev) => [...prev, userMsg, botMsg]);
      setSimStep('phone');
    } else if (simStep === 'phone') {
      const normalized = normalizeIranianPhone(text);
      if (!normalized) {
        const userMsg: SimMessage = {
          id: nextMsgId(),
          sender: 'user',
          text: text,
          time: getTimeString()
        };
        const botMsg: SimMessage = {
          id: nextMsgId(),
          sender: 'bot',
          text: 'شماره وارد شده معتبر نیست. لطفاً یک شماره موبایل صحیح (مثلاً 09123456789) ارسال کنید:',
          time: getTimeString()
        };
        setMessages((prev) => [...prev, userMsg, botMsg]);
        return;
      }

      setSimUserPhone(normalized);
      setSimPhoneMethod('manual_text');
      proceedToChannelCheck(normalized, 'manual_text', text);
    } else {
      const userMsg: SimMessage = {
        id: nextMsgId(),
        sender: 'user',
        text: text,
        time: getTimeString()
      };
      setMessages((prev) => [...prev, userMsg]);
    }
  };

  const handleShareContactSim = () => {
    const fakePhone = '09123456789';
    setSimUserPhone(fakePhone);
    setSimPhoneMethod('contact_share');
    proceedToChannelCheck(fakePhone, 'contact_share', '📱 کارت مخاطب تلگرام (09123456789)');
  };

  const normalizeIranianPhone = (phone: string): string | null => {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    let clean = phone;
    for (let i = 0; i < 10; i++) {
      clean = clean.split(persianDigits[i]).join(i.toString());
      clean = clean.split(arabicDigits[i]).join(i.toString());
    }
    clean = clean.replace(/[^\d+]/g, '');
    if (clean.startsWith('0098')) {
      clean = '0' + clean.substring(4);
    } else if (clean.startsWith('+98')) {
      clean = '0' + clean.substring(3);
    } else if (clean.startsWith('98') && clean.length === 12) {
      clean = '0' + clean.substring(2);
    }
    if (/^09\d{9}$/.test(clean)) {
      return clean;
    }
    return null;
  };

  const proceedToChannelCheck = (phone: string, method: 'contact_share' | 'manual_text', displayUserText: string) => {
    const userMsg: SimMessage = {
      id: nextMsgId(),
      sender: 'user',
      text: displayUserText,
      time: getTimeString()
    };

    if (!requirePublicChannel) {
      grantSimEligibility(userMsg);
      return;
    }

    const botMsg: SimMessage = {
      id: nextMsgId(),
      sender: 'bot',
      text: "یک گام تا دسترسی کامل به مینی‌دوره باقی مونده! 📢\n\nلطفاً ابتدا در کانال اطلاع‌رسانی ویرا انگلیش عضو شو و بعد دکمه بررسی رو بزن:",
      buttons: [
        { text: 'عضویت در کانال عمومی ویرا 📢', action: 'open_channel', url: 'https://t.me/viraa_english' },
        { text: 'عضو شدم؛ بررسی کن ✅', action: 'check_channel' }
      ],
      time: getTimeString()
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setSimStep('channel');
  };

  const triggerJoinRequest = () => {
    setSimStep('requested');
    const userMsg: SimMessage = {
      id: nextMsgId(),
      sender: 'user',
      text: '📎 درخواست ورود به کانال مینی‌دوره ارسال شد (Chat Join Request)',
      time: getTimeString()
    };
    const botMsg: SimMessage = {
      id: nextMsgId(),
      sender: 'bot',
      text: "درخواستت ثبت شد و در حال بررسیه! ⏳\nبه زودی با صف خودکار تأیید میشه و پیامی برات میاد.",
      time: getTimeString()
    };
    setMessages((prev) => [...prev, userMsg, botMsg]);

    setTimeout(() => {
      autoApproveJoinRequest();
    }, 1500);
  };

  const autoApproveJoinRequest = () => {
    setSimStep('approved');
    const botApprovedMsg: SimMessage = {
      id: nextMsgId(),
      sender: 'bot',
      text: "دسترسی مینی‌دوره برات فعال شد! 🌟\nهم‌اکنون می‌تونی وارد کانال بشی و اولین درس رو شروع کنی:",
      buttons: [
        { text: 'شروع درس‌های مینی‌دوره 🚀', action: 'open_channel', url: 'https://t.me/viraa_english' }
      ],
      time: getTimeString()
    };
    setMessages((prev) => [...prev, botApprovedMsg]);

    const newUser: SimulatedUser = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      telegram_id: '71928340',
      name: simUserName || 'کاربر تستی',
      username: 'viraa_learner',
      phone: simUserPhone || '09120000000',
      phone_method: simPhoneMethod,
      phone_verified: simPhoneMethod === 'contact_share',
      public_channel_verified: true,
      is_eligible: true,
      private_channel_status: 'approved',
      created_at: 'همین الان'
    };
    setSimulatedUsers((prev) => [newUser, ...prev]);
  };

  const resetSimulation = () => {
    setSimStep('start');
    setSimUserName('');
    setSimUserPhone('');
    setHasEarlyJoinRequest(false);
    setMessages([
      {
        id: nextMsgId(),
        sender: 'bot',
        text: "سلام کاربر عزیز! 👋\n\nبه مینی‌دوره رایگان ویرا انگلیش خوش اومدی.\nتوی این مینی‌دوره قراره مهم‌ترین تکنیک‌های یادگیری مکالمه انگلیسی رو با هم یاد بگیریم.\n\nبرای شروع، لطفاً دکمه زیر رو بزن تا مراحل رو با هم پیش بریم:",
        buttons: [{ text: 'دریافت دسترسی رایگان 🚀', action: 'start_registration' }],
        time: getTimeString()
      }
    ]);
  };

  const handleCopyCode = (text: string, name: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFile(name);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const downloadAllAsZip = async () => {
    setZipDownloading(true);
    try {
      const zip = new JSZip();
      const botFolder = zip.folder('viraa-telegram-bot');

      BOT_FILES.forEach((f) => {
        botFolder?.file(f.path, f.content);
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'viraa-english-telegram-bot-pure-php.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setZipDownloading(false);
    }
  };

  const handleLaunchBroadcast = () => {
    setBroadcastStatus('sending');
    setBroadcastProgress(0);
    let p = 0;
    const interval = setInterval(() => {
      p += 25;
      if (p >= 100) {
        clearInterval(interval);
        setBroadcastProgress(100);
        setBroadcastStatus('completed');
      } else {
        setBroadcastProgress(p);
      }
    }, 400);
  };

  const handleManualApproveSubmit = () => {
    if (!selectedUser) return;
    setSimulatedUsers((prev) =>
      prev.map((u) =>
        u.id === selectedUser.id
          ? { ...u, is_eligible: true, private_channel_status: 'approved' }
          : u
      )
    );
    setSelectedUser(null);
    setManualApproveReason('');
  };

  const filteredUsers = simulatedUsers.filter((u) => {
    const matchSearch =
      u.name.includes(searchQuery) ||
      u.phone.includes(searchQuery) ||
      u.telegram_id.includes(searchQuery);
    if (!matchSearch) return false;
    if (filterStatus === 'eligible') return u.is_eligible;
    if (filterStatus === 'approved') return u.private_channel_status === 'approved';
    if (filterStatus === 'contact_verified') return u.phone_verified;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
              VE
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg text-white">ویرا انگلیش</h1>
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  PHP خام (آماده استقرار)
                </span>
              </div>
              <p className="text-xs text-slate-400">سامانه جامع ربات تلگرام، احراز هویت، صف تأیید خودکار و پنل مینی‌دوره</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={downloadAllAsZip}
              disabled={zipDownloading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition shadow-md shadow-indigo-600/20 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {zipDownloading ? 'در حال فشرده‌سازی...' : 'دانلود سورس کامل ربات (ZIP)'}
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto border-t border-slate-800/60 pt-1">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'simulator'
                ? 'border-sky-500 text-sky-400 bg-sky-500/10 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            شبیه‌ساز زنده تلگرام
          </button>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'dashboard'
                ? 'border-sky-500 text-sky-400 bg-sky-500/10 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            پنل مدیریت و قیف تبدیل
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'code'
                ? 'border-sky-500 text-sky-400 bg-sky-500/10 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-4 h-4" />
            مرورگر فایل‌های PHP ({BOT_FILES.length})
          </button>
          <button
            onClick={() => setActiveTab('deployment')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === 'deployment'
                ? 'border-sky-500 text-sky-400 bg-sky-500/10 rounded-t'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-4 h-4" />
            چک‌لیست استقرار سرور
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  تنظیمات سناریو و آزمون
                </h3>
                <button
                  onClick={resetSimulation}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  شروع مجدد
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-medium">شرط عضویت کانال عمومی</span>
                    <button
                      onClick={() => setRequirePublicChannel(!requirePublicChannel)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                        requirePublicChannel ? 'bg-sky-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          requirePublicChannel ? 'translate-x-0' : '-translate-x-4'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {requirePublicChannel
                      ? 'فعال: پس از ثبت شماره، عضویت در کانال عمومی فقط ۱ بار بررسی می‌شود.'
                      : 'خاموش: مرحله کانال عمومی حذف و دسترسی فوراً اعطا می‌شود.'}
                  </p>
                </div>

                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-medium">وضعیت عضویت در کانال عمومی</span>
                    <button
                      onClick={() => setIsChannelMember(!isChannelMember)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                        isChannelMember
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {isChannelMember ? 'عضو است' : 'عضو نیست'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    برای شبیه‌سازی تست دکمه «عضو شدم؛ بررسی کن»، می‌توانید این کلید را تغییر دهید.
                  </p>
                </div>

                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-medium">درخواست عضویت قبل از ثبت‌نام</span>
                    <button
                      onClick={() => setHasEarlyJoinRequest(!hasEarlyJoinRequest)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                        hasEarlyJoinRequest
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {hasEarlyJoinRequest ? 'فعال (پیش از شروع)' : 'غیرفعال'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    اگر کاربری ابتدا لینک کانال را از دوستش بگیرد و درخواست دهد، درخواست در سیستم معلق می‌ماند تا وقتی در بات ثبت‌نام کرد خودکار تأیید شود.
                  </p>
                </div>

                <div className="p-3 bg-indigo-950/40 rounded-xl border border-indigo-900/40 space-y-1.5">
                  <div className="font-semibold text-indigo-300 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                    وضعیت پردازشگر صف (Worker)
                  </div>
                  <p className="text-[11px] text-slate-300">
                    درخواست‌های تأیید با lease و قفل ایمن به `approveChatJoinRequest` تلگرام ارسال می‌شوند.
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800">
                <div className="text-[11px] text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>مرحله جاری کاربر:</span>
                    <span className="font-mono text-sky-400">{simStep}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>نام ثبت‌شده:</span>
                    <span className="text-slate-200">{simUserName || 'هنوز وارد نشده'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>شماره ثبت‌شده:</span>
                    <span className="font-mono text-slate-200">{simUserPhone || 'هنوز وارد نشده'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-8 flex justify-center">
              <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col h-[680px]">
                <div className="bg-slate-800/90 px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-bold text-white text-sm">
                        VE
                      </div>
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-slate-800"></span>
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-white flex items-center gap-1.5">
                        ویرا انگلیش | مینی‌دوره
                        <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                      </div>
                      <div className="text-[11px] text-slate-400">bot • @viraa_mini_course_bot</div>
                    </div>
                  </div>
                  <span className="text-[11px] bg-slate-700/50 text-slate-300 px-2 py-0.5 rounded-full">
                    محیط شبیه‌ساز
                  </span>
                </div>

                <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-gradient-to-b from-slate-950 via-slate-900/60 to-slate-950">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed whitespace-pre-line shadow ${
                          m.sender === 'user'
                            ? 'bg-sky-600 text-white rounded-br-none'
                            : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700/50'
                        }`}
                      >
                        {m.text}
                        <div
                          className={`text-[9px] mt-1.5 text-left font-mono ${
                            m.sender === 'user' ? 'text-sky-200' : 'text-slate-400'
                          }`}
                        >
                          {m.time}
                        </div>
                      </div>

                      {m.buttons && m.buttons.length > 0 && (
                        <div className="mt-2 space-y-1.5 w-[85%]">
                          {m.buttons.map((b, idx) => (
                            <button
                              key={`${m.id}_btn_${b.action}_${idx}`}
                              onClick={() => {
                                if (b.action === 'share_contact') {
                                  handleShareContactSim();
                                } else {
                                  handleSimButton(b.action);
                                }
                              }}
                              className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-sky-300 text-xs font-medium text-center transition flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98]"
                            >
                              {b.text}
                              {b.url && <ExternalLink className="w-3 h-3 text-slate-400" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="p-3 bg-slate-800/80 border-t border-slate-700/60">
                  {simStep === 'phone' ? (
                    <div className="space-y-2">
                      <button
                        onClick={handleShareContactSim}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center justify-center gap-2 transition shadow-md shadow-emerald-600/20"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        📱 ارسال شماره من (تأیید رسمی تلگرام)
                      </button>
                      <form onSubmit={handleSimInputSubmit} className="flex gap-2">
                        <input
                          type="text"
                          value={inputText}
                          onChange={(e) => setInputText(e.target.value)}
                          placeholder="یا شماره را دستی بنویسید (مثلاً 09123456789)..."
                          className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                        />
                        <button
                          type="submit"
                          className="px-3 bg-sky-600 hover:bg-sky-500 rounded-xl text-white flex items-center justify-center transition"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    </div>
                  ) : (
                    <form onSubmit={handleSimInputSubmit} className="flex gap-2">
                      <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder={
                          simStep === 'name'
                            ? 'نام خود را اینجا بنویسید...'
                            : 'پیامی بنویسید یا دکمه‌های بالا را بزنید...'
                        }
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="submit"
                        className="px-3 bg-sky-600 hover:bg-sky-500 rounded-xl text-white flex items-center justify-center transition"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-xs text-slate-400 font-medium">کل کاربران استارت‌زده</div>
                <div className="text-2xl font-bold text-white mt-1">۱,۴۸۲</div>
                <div className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
                  <span>+۱۲٪</span> نسبت به دیروز
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-xs text-slate-400 font-medium">ثبت شماره تماس</div>
                <div className="text-2xl font-bold text-sky-400 mt-1">۱,۲۱۴</div>
                <div className="text-[11px] text-slate-400 mt-1">۸۱.۹٪ نرخ تبدیل نام به شماره</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-xs text-slate-400 font-medium">واجدین شرایط مینی‌دوره</div>
                <div className="text-2xl font-bold text-indigo-400 mt-1">۱,۰۸۵</div>
                <div className="text-[11px] text-slate-400 mt-1">عبور از شرط کانال عمومی</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-xs text-slate-400 font-medium">تأیید عضویت در کانال خصوصی</div>
                <div className="text-2xl font-bold text-emerald-400 mt-1">۹۶۲</div>
                <div className="text-[11px] text-slate-400 mt-1">تأیید خودکار توسط صف ربات</div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-sky-400" />
                  قیف تبدیل گام‌به‌گام مینی‌دوره (Conversion Funnel)
                </h3>
                <span className="text-xs text-slate-400">نرخ تبدیل نهایی: ۶۴.۹٪</span>
              </div>

              <div className="space-y-3">
                {[
                  { step: '۱. استارت ربات (/start)', count: 1482, rate: '۱۰۰٪', pct: 100, color: 'bg-sky-500' },
                  { step: '۲. ثبت نام کاربر', count: 1350, rate: '۹۱.۱٪', pct: 91, color: 'bg-sky-600' },
                  { step: '۳. ثبت شماره موبایل', count: 1214, rate: '۸۱.۹٪', pct: 82, color: 'bg-indigo-500' },
                  { step: '۴. بررسی عضویت کانال عمومی', count: 1120, rate: '۷۵.۵٪', pct: 75, color: 'bg-indigo-600' },
                  { step: '۵. اعطای واجد شرایط بودن', count: 1085, rate: '۷۳.۲٪', pct: 73, color: 'bg-purple-600' },
                  { step: '۶. ارسال درخواست به کانال خصوصی', count: 998, rate: '۶۷.۳٪', pct: 67, color: 'bg-pink-600' },
                  { step: '۷. تأیید قطعی عضویت در کانال', count: 962, rate: '۶۴.۹٪', pct: 65, color: 'bg-emerald-500' }
                ].map((item) => (
                  <div key={item.step} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium">{item.step}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-slate-400">{item.count.toLocaleString()} نفر</span>
                        <span className="font-mono text-sky-400 font-bold w-12 text-left">{item.rate}</span>
                      </div>
                    </div>
                    <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-bold text-white text-sm flex items-center gap-2">
                    <Users className="w-4 h-4 text-sky-400" />
                    مدیریت کاربران و وضعیت دسترسی
                  </h3>

                  <div className="flex items-center gap-2">
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                    >
                      <option value="all">همه کاربران</option>
                      <option value="eligible">فقط واجدین شرایط</option>
                      <option value="approved">عضو تأییدشده کانال</option>
                      <option value="contact_verified">دارای تأیید رسمی شماره</option>
                    </select>

                    <input
                      type="text"
                      placeholder="جستجوی نام، شناسه یا شماره..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none w-48"
                    >
                    </input>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="pb-2.5 font-medium">شناسه تلگرام</th>
                        <th className="pb-2.5 font-medium">نام</th>
                        <th className="pb-2.5 font-medium">شماره تماس</th>
                        <th className="pb-2.5 font-medium">روش شماره</th>
                        <th className="pb-2.5 font-medium">کانال عمومی</th>
                        <th className="pb-2.5 font-medium">کانال مینی‌دوره</th>
                        <th className="pb-2.5 font-medium">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 font-mono text-slate-400">{u.telegram_id}</td>
                          <td className="py-2.5 font-medium text-white">{u.name}</td>
                          <td className="py-2.5 font-mono text-slate-300" dir="ltr">{u.phone}</td>
                          <td className="py-2.5">
                            {u.phone_verified ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">
                                رسمی تلگرام
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[10px]">
                                تایپ دستی
                              </span>
                            )}
                          </td>
                          <td className="py-2.5">
                            {u.public_channel_verified ? (
                              <span className="text-emerald-400">تأیید شده</span>
                            ) : (
                              <span className="text-slate-500">عدم عضویت</span>
                            )}
                          </td>
                          <td className="py-2.5">
                            {u.private_channel_status === 'approved' ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px]">
                                تأیید شده ✅
                              </span>
                            ) : u.private_channel_status === 'pending' ? (
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px]">
                                در صف تأیید ⏳
                              </span>
                            ) : (
                              <span className="text-slate-500">بدون درخواست</span>
                            )}
                          </td>
                          <td className="py-2.5">
                            {u.private_channel_status !== 'approved' && (
                              <button
                                onClick={() => setSelectedUser(u)}
                                className="px-2 py-1 rounded bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 border border-sky-500/40 text-[10px] font-medium transition"
                              >
                                تأیید دستی
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Send className="w-4 h-4 text-sky-400" />
                  ارسال پیام انبوه (Broadcast)
                </h3>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">عنوان کمپین:</label>
                    <input
                      type="text"
                      value={broadcastTitle}
                      onChange={(e) => setBroadcastTitle(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">مخاطبان هدف (Segmentation):</label>
                    <select
                      value={broadcastSegment}
                      onChange={(e) => setBroadcastSegment(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-sky-500"
                    >
                      <option value="all">همه کاربران (۱,۴۸۲ نفر)</option>
                      <option value="eligible">واجدین شرایط مینی‌دوره (۱,۰۸۵ نفر)</option>
                      <option value="approved">اعضای تأییدشده کانال خصوصی (۹۶۲ نفر)</option>
                      <option value="with_phone">کاربران دارای شماره تماس (۱,۲۱۴ نفر)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">متن پیام (با پشتیبانی از نام):</label>
                    <textarea
                      rows={4}
                      value={broadcastText}
                      onChange={(e) => setBroadcastText(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-sky-500 font-sans"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-400 mb-1">متن دکمه:</label>
                      <input
                        type="text"
                        value={broadcastButtonText}
                        onChange={(e) => setBroadcastButtonText(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">لینک دکمه:</label>
                      <input
                        type="text"
                        value={broadcastButtonUrl}
                        onChange={(e) => setBroadcastButtonUrl(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:outline-none font-mono text-[11px]"
                      />
                    </div>
                  </div>

                  {broadcastStatus === 'sending' && (
                    <div className="space-y-1.5 pt-2">
                      <div className="flex justify-between text-[11px] text-slate-300">
                        <span>در حال ارسال از طریق صف با نرخ ۲۵ پیام/ثانیه...</span>
                        <span>{broadcastProgress}٪</span>
                      </div>
                      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-sky-500 transition-all duration-300"
                          style={{ width: `${broadcastProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {broadcastStatus === 'completed' && (
                    <div className="p-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-center font-medium">
                      کمپین با موفقیت به پایان رسید! ✅
                    </div>
                  )}

                  <div className="pt-2 flex gap-2">
                    <button
                      onClick={handleLaunchBroadcast}
                      disabled={broadcastStatus === 'sending'}
                      className="flex-1 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5" />
                      شروع ارسال انبوه
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'code' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-sky-400" />
                  فایل‌های سورس PHP خالص ({BOT_FILES.length})
                </span>
                <span className="text-[10px] text-slate-400">PHP 8.1+ / PDO</span>
              </div>

              <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
                {BOT_FILES.map((f) => (
                  <button
                    key={f.name}
                    onClick={() => setSelectedFile(f)}
                    className={`w-full text-right p-2.5 rounded-xl text-xs transition flex flex-col gap-0.5 ${
                      selectedFile.name === f.name
                        ? 'bg-sky-600/20 text-sky-300 border border-sky-500/30'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-mono font-medium flex items-center justify-between">
                      <span>{f.name}</span>
                      <span className="text-[10px] text-slate-500 font-sans">
                        {f.content.split('\n').length} خط
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-sans line-clamp-1">
                      {f.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[680px]">
              <div className="bg-slate-800/90 px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
                <div>
                  <div className="font-mono text-sm font-semibold text-white">{selectedFile.path}</div>
                  <div className="text-xs text-slate-400">{selectedFile.description}</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyCode(selectedFile.content, selectedFile.name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-white transition"
                  >
                    {copiedFile === selectedFile.name ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        کپی شد!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        کپی کد
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex-1 p-4 bg-slate-950 overflow-auto font-mono text-xs text-slate-300 leading-relaxed" dir="ltr">
                <pre>{selectedFile.content}</pre>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'deployment' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <Server className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">راهنمای استقرار گام‌به‌گام برای مدیر سرور</h2>
                  <p className="text-xs text-slate-400">
                    این ربات بدون نیاز به فریم‌ورک‌های سنگین و تنها با PHP 8.1+ و دیتابیس داخلی SQLite یا MySQL اجرا می‌شود.
                  </p>
                </div>
              </div>

              <div className="bg-gradient-to-r from-sky-950/60 to-indigo-950/60 p-4 rounded-xl border border-sky-800/40 space-y-3">
                <div className="flex items-center gap-2 text-sky-300 font-bold text-sm">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  روش فوق‌سریع راه‌اندازی روی هاست اشتراکی (cPanel / DirectAdmin) با مرورگر
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  روی هاست اشتراکی نیازی به دستورات ترمینال یا SSH ندارید! فقط فایل‌های پوشه bot را داخل <code>public_html</code> آپلود کنید و مراحل زیر را با مرورگر انجام دهید:
                </p>
                <div className="space-y-2 text-xs">
                  <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="font-semibold text-emerald-400">گام ۱: ساخت خودکار دیتابیس با مرورگر</span>
                    <div className="font-mono text-slate-300" dir="ltr">https://YOUR_DOMAIN.com/index.php?action=install</div>
                  </div>
                  <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="font-semibold text-sky-400">گام ۲: تنظیم وب‌هوک با یک کلیک در مرورگر</span>
                    <div className="font-mono text-slate-300" dir="ltr">https://YOUR_DOMAIN.com/index.php?action=set_webhook</div>
                    <div className="text-[11px] text-slate-400">همچنین از طریق لینک مستقیم تلگرام:</div>
                    <div className="font-mono text-[11px] text-indigo-300 overflow-x-auto" dir="ltr">
                      https://api.telegram.org/bot&lt;YOUR_TOKEN&gt;/setWebhook?url=https://YOUR_DOMAIN.com/index.php?action=webhook
                    </div>
                  </div>
                  <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="font-semibold text-purple-400">گام ۳: بررسی وضعیت وب‌هوک در مرورگر</span>
                    <div className="font-mono text-slate-300" dir="ltr">https://YOUR_DOMAIN.com/index.php?action=get_webhook_info</div>
                  </div>
                  <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="font-semibold text-amber-400">گام ۴ (اختیاری): کران جاب هاست برای ارسال پیام انبوه</span>
                    <div className="text-[11px] text-slate-400">در بخش Cron Jobs سی‌پنل هر ۵ دقیقه یکبار:</div>
                    <div className="font-mono text-[11px] text-amber-300" dir="ltr">curl -s "https://YOUR_DOMAIN.com/index.php?action=run_worker" &gt; /dev/null 2&gt;&amp;1</div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                {[
                  {
                    step: '۱. کپی فایل‌ها روی سرور',
                    cmd: 'mkdir -p /var/www/viraa-bot && cd /var/www/viraa-bot\n# فایل‌های پروژه را در این مسیر قرار دهید',
                    desc: 'پوشه ربات را در مسیر وب‌سرور قرار دهید.'
                  },
                  {
                    step: '۲. تنظیم فایل پیکربندی (config.php)',
                    cmd: 'cp .env.example .env\nnano config.php',
                    desc: 'توکن ربات و شناسه‌های کانال را در config.php یا .env وارد کنید.'
                  },
                  {
                    step: '۳. اجرای نصب‌کننده اولیه',
                    cmd: 'php install.php',
                    desc: 'جداول پایگاه‌داده ساخته شده و تنظیمات اولیه پیام‌های فارسی بارگذاری می‌شوند.'
                  },
                  {
                    step: '۴. بررسی سلامت و پیش‌نیازها (Doctor)',
                    cmd: 'php doctor.php',
                    desc: 'صحت توکن، وب‌هوک، دسترسی‌های فایل و اتصال پایگاه‌داده را می‌سنجد.'
                  },
                  {
                    step: '۵. ثبت وب‌هوک در سرور تلگرام',
                    cmd: 'curl -F "url=https://YOUR_DOMAIN.com/webhook" -F "secret_token=YOUR_SECRET" https://api.telegram.org/botYOUR_TOKEN/setWebhook',
                    desc: 'تلگرام تمام آپدیت‌ها را به آدرس /webhook ارسال می‌کند.'
                  },
                  {
                    step: '۶. فعال‌سازی صف‌خوان دائمی (Systemd Worker)',
                    cmd: 'sudo nano /etc/systemd/system/viraa-worker.service\n# سپس:\nsudo systemctl daemon-reload && sudo systemctl enable --now viraa-worker',
                    desc: 'درخواست‌های ورود به کانال و پیام‌های انبوه بدون تأخیر در پس‌زمینه تأیید می‌شوند.'
                  }
                ].map((item, idx) => (
                  <div key={item.step} className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">{item.step}</span>
                      <span className="text-xs text-slate-400">{item.desc}</span>
                    </div>
                    <div className="relative">
                      <pre className="bg-slate-900 p-3 rounded-lg text-xs font-mono text-sky-300 overflow-x-auto" dir="ltr">
                        {item.cmd}
                      </pre>
                      <button
                        onClick={() => handleCopyCode(item.cmd, `step-${idx}`)}
                        className="absolute top-2 right-2 p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                      >
                        {copiedFile === `step-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {selectedUser && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-white text-sm">تأیید دستی دسترسی کاربر (Override)</h3>
              <button onClick={() => setSelectedUser(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="text-xs space-y-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div>نام کاربر: <strong className="text-white">{selectedUser.name}</strong></div>
              <div>شناسه تلگرام: <span className="font-mono text-sky-400">{selectedUser.telegram_id}</span></div>
              <div>شماره تماس: <span className="font-mono text-slate-300" dir="ltr">{selectedUser.phone}</span></div>
            </div>

            <div className="space-y-1.5 text-xs">
              <label className="text-slate-400">علت تأیید دستی (جهت ثبت در Audit Log):</label>
              <textarea
                rows={3}
                value={manualApproveReason}
                onChange={(e) => setManualApproveReason(e.target.value)}
                placeholder="مثلاً: هماهنگی پشتیبانی، پرداخت دستی یا استثنای مدیر..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white focus:outline-none focus:border-sky-500 font-sans"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleManualApproveSubmit}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition"
              >
                تأیید دسترسی کانال مینی‌دوره
              </button>
              <button
                onClick={() => setSelectedUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
