import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function KayitPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Kayıt ol</CardTitle>
        <CardDescription>
          Finansal Asistan&apos;ı kullanmak için bir hesap oluştur.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Zaten hesabın var mı?{" "}
          <Link href="/giris" className="font-medium text-primary">
            Giriş yap
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
