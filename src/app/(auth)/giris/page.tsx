import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/LoginForm";

export default function GirisPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Giriş yap</CardTitle>
        <CardDescription>Finansal Asistan hesabınla devam et.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Hesabın yok mu?{" "}
          <Link href="/kayit" className="font-medium text-primary">
            Kayıt ol
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
